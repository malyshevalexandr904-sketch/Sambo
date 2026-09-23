// Вход, регистрация, подтверждение email, восстановление и смена пароля (API.md, 3.1).
import { Inject, Injectable } from '@nestjs/common';
import type { Locale, LoginRequest, Me, RegisterRequest } from '@sde/contracts';
import { Prisma, type Tx, uuidv7 } from '@sde/db';
import {
  burnPasswordCheck,
  type Env,
  hashPassword,
  type LeakedPasswordChecker,
  passwordNeedsRehash,
  verifyPassword,
} from '@sde/server-kit';
import { DomainError } from '../../../common/errors/domain-error';
import { RateLimitService } from '../../../common/security/rate-limit';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { EmailRequestService, OutboxService } from '../../outbox';
import { SettingsService } from '../../settings';
import { MeService } from '../../users';
import { EMAIL_VERIFY_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS } from '../domain/session-policy';
import { type IssuedSession, SessionService } from './session.service';
import { TotpService } from './totp.service';
import { VerificationTokenService } from './verification-token.service';

export const LEAKED_PASSWORD_CHECKER = Symbol('LEAKED_PASSWORD_CHECKER');

export interface LoginResult {
  me: Me;
  session: IssuedSession;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly sessions: SessionService,
    private readonly tokens: VerificationTokenService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly emails: EmailRequestService,
    private readonly settings: SettingsService,
    private readonly me: MeService,
    private readonly limiter: RateLimitService,
    @Inject(LEAKED_PASSWORD_CHECKER) private readonly leaked: LeakedPasswordChecker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private link(locale: Locale, path: string, token: string): string {
    return `${this.env.APP_URL.replace(/\/$/, '')}/${locale}${path}?token=${encodeURIComponent(token)}`;
  }

  private async assertPasswordAcceptable(password: string, field: string): Promise<void> {
    if (!(await this.settings.get('auth.leakedPasswordCheckEnabled'))) return;
    if (await this.leaked.isLeaked(password)) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: field, code: 'password_leaked' }] });
    }
  }

  /** Ответ всегда одинаковый: занятость email не раскрывается (API.md, 3.1). */
  async register(input: RegisterRequest): Promise<void> {
    await this.limiter.hit('authEmail', `register:${input.email}`);
    if (!(await this.settings.get('registration.selfSignupEnabled'))) throw new DomainError('FORBIDDEN', { reason: 'signup_disabled' });
    await this.assertPasswordAcceptable(input.password, 'password');
    const secretHash = await hashPassword(input.password);
    try {
      await this.db.tx(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, locale: true } });
        if (existing) {
          await this.emails.request(tx, {
            template: 'auth.account_exists',
            to: input.email,
            userId: existing.id,
            locale: existing.locale === 'en' ? 'en' : 'ru',
            params: { loginUrl: `${this.env.APP_URL}/${input.locale}/login`, resetUrl: `${this.env.APP_URL}/${input.locale}/forgot-password` },
          });
          return;
        }
        const userId = uuidv7();
        await tx.user.create({
          data: { id: userId, email: input.email, displayName: input.displayName, locale: input.locale, status: 'PENDING_VERIFICATION' },
        });
        await tx.authIdentity.create({
          data: { id: uuidv7(), userId, provider: 'EMAIL_PASSWORD', providerSubject: input.email, secretHash },
        });
        const token = await this.tokens.issue(tx, 'EMAIL_VERIFY', { userId, ttlSeconds: EMAIL_VERIFY_TTL_SECONDS });
        await this.emails.request(tx, {
          template: 'auth.verify_email',
          to: input.email,
          userId,
          locale: input.locale,
          params: { verifyUrl: this.link(input.locale, '/verify-email', token), displayName: input.displayName },
        });
        await this.audit.record(tx, { action: 'user.registered', entityType: 'User', entityId: userId, actorUserId: userId });
        await this.outbox.enqueue(tx, { type: 'user.registered', aggregate: { type: 'User', id: userId }, payload: { userId } });
      });
    } catch (e) {
      // Гонка двух регистраций одного email: для клиента ответ тот же.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
  }

  async verifyEmail(token: string): Promise<LoginResult> {
    const { userId, session } = await this.db.tx(async (tx) => {
      const consumed = await this.tokens.consume(tx, 'EMAIL_VERIFY', token);
      if (!consumed.userId) throw new DomainError('TOKEN_EXPIRED');
      const user = await tx.user.findUniqueOrThrow({ where: { id: consumed.userId } });
      if (user.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), status: 'ACTIVE', lastLoginAt: new Date() },
      });
      await this.audit.record(tx, { action: 'user.email_verified', entityType: 'User', entityId: user.id, actorUserId: user.id });
      return { userId: user.id, session: await this.sessions.create(tx, updated) };
    });
    return { me: await this.me.get(userId), session };
  }

  async login(input: LoginRequest): Promise<LoginResult> {
    await this.limiter.hit('authEmail', `login:${input.email}`);
    const identity = await this.db.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: 'EMAIL_PASSWORD', providerSubject: input.email } },
      include: { user: true },
    });
    if (!identity?.secretHash) {
      await burnPasswordCheck(input.password);
      throw new DomainError('INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(identity.secretHash, input.password))) throw new DomainError('INVALID_CREDENTIALS');
    const user = identity.user;
    if (user.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
    if (user.status === 'PENDING_VERIFICATION') throw new DomainError('EMAIL_NOT_VERIFIED');

    const session = await this.db.tx(async (tx) => {
      if (user.totpEnabledAt) {
        if (!input.totpCode) throw new DomainError('TOTP_REQUIRED');
        if (!(await this.totp.verify(tx, user, input.totpCode))) throw new DomainError('TOTP_INVALID');
      }
      if (passwordNeedsRehash(identity.secretHash ?? '')) {
        await tx.authIdentity.update({ where: { id: identity.id }, data: { secretHash: await hashPassword(input.password) } });
      }
      await tx.authIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const platformRoles = await tx.platformRoleAssignment.count({ where: { userId: user.id, revokedAt: null } });
      if (platformRoles > 0) {
        await this.audit.record(tx, { action: 'auth.login', entityType: 'User', entityId: user.id, actorUserId: user.id });
      }
      return this.sessions.create(tx, user);
    });
    return { me: await this.me.get(user.id), session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.tx((tx) => this.sessions.revoke(tx, sessionId, 'logout'));
    await this.sessions.blockSessions([sessionId]);
  }

  /** Всегда 202: существование email не раскрывается. Старые ссылки сброса гасятся. */
  async forgotPassword(email: string, locale: Locale): Promise<void> {
    await this.limiter.hit('authEmail', `forgot:${email}`);
    await this.db.tx(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'EMAIL_PASSWORD', providerSubject: email } },
        include: { user: { select: { id: true, status: true, locale: true } } },
      });
      if (!identity || identity.user.status === 'BLOCKED') return;
      const userLocale: Locale = identity.user.locale === 'en' ? 'en' : locale;
      await this.tokens.invalidateAll(tx, identity.user.id, 'PASSWORD_RESET');
      const token = await this.tokens.issue(tx, 'PASSWORD_RESET', { userId: identity.user.id, ttlSeconds: PASSWORD_RESET_TTL_SECONDS });
      await this.emails.request(tx, {
        template: 'auth.password_reset',
        to: email,
        userId: identity.user.id,
        locale: userLocale,
        params: { resetUrl: this.link(userLocale, '/reset-password', token) },
      });
    });
  }

  /** Новый пароль по ссылке. Все сессии отзываются. Ссылка из письма подтверждает и сам email. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.assertPasswordAcceptable(newPassword, 'newPassword');
    const secretHash = await hashPassword(newPassword);
    const revoked = await this.db.tx(async (tx) => {
      const consumed = await this.tokens.consume(tx, 'PASSWORD_RESET', token);
      if (!consumed.userId) throw new DomainError('TOKEN_EXPIRED');
      const user = await tx.user.findUniqueOrThrow({ where: { id: consumed.userId } });
      if (user.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
      await tx.authIdentity.updateMany({ where: { userId: user.id, provider: 'EMAIL_PASSWORD' }, data: { secretHash } });
      if (user.status === 'PENDING_VERIFICATION') {
        await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } });
      }
      const families = await this.sessions.revokeAll(tx, user.id, 'password_reset');
      await this.audit.record(tx, { action: 'auth.password_reset', entityType: 'User', entityId: user.id, actorUserId: user.id });
      await this.notifyPasswordChanged(tx, user);
      return families;
    });
    await this.sessions.blockSessions(revoked);
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void> {
    const identity = await this.db.authIdentity.findFirst({ where: { userId, provider: 'EMAIL_PASSWORD' } });
    if (!identity?.secretHash || !(await verifyPassword(identity.secretHash, current))) throw new DomainError('INVALID_CREDENTIALS');
    await this.assertPasswordAcceptable(next, 'newPassword');
    const secretHash = await hashPassword(next);
    const revoked = await this.db.tx(async (tx) => {
      await tx.authIdentity.update({ where: { id: identity.id }, data: { secretHash } });
      const families = await this.sessions.revokeAll(tx, userId, 'password_changed', sessionId);
      await this.audit.record(tx, { action: 'auth.password_changed', entityType: 'User', entityId: userId });
      await this.notifyPasswordChanged(tx, await tx.user.findUniqueOrThrow({ where: { id: userId } }));
      return families;
    });
    await this.sessions.blockSessions(revoked);
  }

  private async notifyPasswordChanged(tx: Tx, user: { id: string; email: string | null; locale: string }): Promise<void> {
    if (!user.email) return;
    const locale: Locale = user.locale === 'en' ? 'en' : 'ru';
    await this.emails.request(tx, {
      template: 'auth.password_changed',
      to: user.email,
      userId: user.id,
      locale,
      params: { resetUrl: `${this.env.APP_URL}/${locale}/forgot-password` },
    });
  }
}
