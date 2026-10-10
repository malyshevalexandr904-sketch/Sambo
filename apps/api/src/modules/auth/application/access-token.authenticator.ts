// Пользователь по access token (cookie или Bearer): общий для HTTP (AuthGuard) и WebSocket-шлюза (Phase 8a).
// Токен проверяется подписью и сроком, сессия — по списку отозванных, пользователь — по статусу.
import { Injectable } from '@nestjs/common';
import type { Locale } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { JwtService } from '../infrastructure/jwt.service';
import { SessionService } from './session.service';

export interface Authenticated {
  user: AuthUser;
  locale: Locale;
  /** Срок действия access token. */
  expiresAt: Date;
}

@Injectable()
export class AccessTokenAuthenticator {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly db: PrismaService,
  ) {}

  /** Ошибки — DomainError: TOKEN_EXPIRED, UNAUTHENTICATED, ACCOUNT_BLOCKED. */
  async authenticate(token: string, via: AuthUser['via']): Promise<Authenticated> {
    const claims = await this.jwt.verify(token);
    if (!(await this.sessions.isActive(claims.sid))) throw new DomainError('UNAUTHENTICATED');
    const user = await this.db.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        status: true,
        permissionsVersion: true,
        totpEnabledAt: true,
        personId: true,
        email: true,
        emailVerifiedAt: true,
        locale: true,
      },
    });
    if (!user || user.status === 'PENDING_VERIFICATION') throw new DomainError('UNAUTHENTICATED');
    if (user.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
    return {
      user: {
        id: user.id,
        sessionId: claims.sid,
        permissionsVersion: user.permissionsVersion,
        totpEnabled: user.totpEnabledAt !== null,
        personId: user.personId,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        via,
      },
      locale: user.locale === 'en' ? 'en' : 'ru',
      expiresAt: claims.expiresAt,
    };
  }
}
