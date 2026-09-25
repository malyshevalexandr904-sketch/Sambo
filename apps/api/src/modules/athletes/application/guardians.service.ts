// Законные представители (API.md, 4.2): добавление, подтверждение тренером или клубом, прекращение,
// приглашение создать аккаунт и привязка аккаунта к записи представителя. «Мои спортсмены».
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type GuardianCreate,
  type GuardianSummary,
  type GuardianVerificationBasis,
  type Locale,
  type MyAthlete,
  publicName,
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import type { Env } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { INVITE_TTL_SECONDS, VerificationTokenService } from '../../auth';
import { EmailRequestService } from '../../outbox';
import { PeopleService, personAudit } from '../../people';
import { currentPeriod } from './athlete-access.service';
import { AthleteExtensions } from './athlete-extensions';
import { guardianDto } from './athlete-mapper';

interface GuardianInvitePayload {
  type: 'GUARDIAN';
  guardianId: string;
  email: string;
}

const isGuardianPayload = (p: unknown): p is GuardianInvitePayload =>
  !!p &&
  typeof p === 'object' &&
  (p as GuardianInvitePayload).type === 'GUARDIAN' &&
  typeof (p as GuardianInvitePayload).guardianId === 'string' &&
  typeof (p as GuardianInvitePayload).email === 'string';

@Injectable()
export class GuardiansService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
    private readonly tokens: VerificationTokenService,
    private readonly emails: EmailRequestService,
    private readonly extensions: AthleteExtensions,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    // Две записи одного человека: связи «представитель» переходят к оставшейся записи.
    this.people.registerMergeHandler(async (tx, from, to) => {
      const links = await tx.guardian.findMany({ where: { guardianPersonId: from, endedAt: null } });
      for (const g of links) {
        const clash = await tx.guardian.findFirst({
          where: { athleteId: g.athleteId, guardianPersonId: to, endedAt: null },
        });
        await tx.guardian.update({
          where: { id: g.id },
          data: clash
            ? { endedAt: new Date(), endReason: 'merged: duplicate person record' }
            : { guardianPersonId: to },
        });
      }
    });
  }

  private async load(tx: Tx, athleteId: string, guardianId: string) {
    const g = await tx.guardian.findFirst({
      where: { id: guardianId, athleteId, endedAt: null },
      include: { guardianPerson: { include: { user: { select: { id: true } } } } },
    });
    if (!g) throw new DomainError('NOT_FOUND', { resource: 'guardian' });
    return g;
  }

  /**
   * Представитель — человек из справочника. Если тот же человек (ФИО, отчество, дата рождения) уже есть —
   * например, родитель второго ребёнка, — используется его запись: один аккаунт родителя видит всех детей.
   */
  async add(
    user: AuthUser,
    athleteId: string,
    input: GuardianCreate,
    locale: Locale,
  ): Promise<GuardianSummary> {
    const id = await this.db.tx(async (tx) => {
      const athlete = await tx.athleteProfile.findUniqueOrThrow({ where: { id: athleteId } });
      const matches = await this.people.exactMatches(tx, input.person, { matchMiddleName: true });
      if (matches.includes(athlete.personId))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'person', code: 'guardian_is_athlete' }],
        });
      const existing = matches[0];
      const personId = existing ?? (await this.people.create(tx, input.person, user.id)).id;
      if (await tx.guardian.findFirst({ where: { athleteId, guardianPersonId: personId, endedAt: null } }))
        throw new DomainError('ALREADY_EXISTS', { resource: 'guardian' });
      const guardian = await tx.guardian.create({
        data: {
          id: uuidv7(),
          athleteId,
          guardianPersonId: personId,
          relation: input.relation,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'guardian.added',
        entityType: 'Guardian',
        entityId: guardian.id,
        after: {
          athleteId,
          relation: input.relation,
          reusedPerson: existing !== undefined,
          ...personAudit(await tx.person.findUniqueOrThrow({ where: { id: personId } })),
        },
      });
      if (input.email) await this.sendInvite(tx, athleteId, guardian.id, input.email, locale);
      return guardian.id;
    });
    return guardianDto(await this.load(this.db, athleteId, id));
  }

  /** Подтверждение: тренер или клуб видели документ представителя (или бумажное заявление). */
  async verify(
    user: AuthUser,
    athleteId: string,
    guardianId: string,
    basis: GuardianVerificationBasis,
  ): Promise<GuardianSummary> {
    await this.db.tx(async (tx) => {
      const g = await this.load(tx, athleteId, guardianId);
      if (g.verifiedAt)
        throw new DomainError('INVALID_TRANSITION', { from: 'VERIFIED', to: 'VERIFIED', allowed: [] });
      await tx.guardian.update({
        where: { id: g.id },
        data: { verifiedAt: new Date(), verifiedById: user.id, verificationBasis: basis },
      });
      await this.audit.record(tx, {
        action: 'guardian.verified',
        entityType: 'Guardian',
        entityId: g.id,
        before: { verified: false },
        after: { verified: true, basis },
      });
    });
    return guardianDto(await this.load(this.db, athleteId, guardianId));
  }

  /** Связь не удаляется, а прекращается с причиной: согласия, данные этим человеком, остаются в истории. */
  async end(user: AuthUser, athleteId: string, guardianId: string, reason: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const g = await this.load(tx, athleteId, guardianId);
      await tx.guardian.update({
        where: { id: g.id },
        data: { endedAt: new Date(), endedById: user.id, endReason: reason },
      });
      await this.audit.record(tx, {
        action: 'guardian.ended',
        entityType: 'Guardian',
        entityId: g.id,
        before: { ended: false },
        after: { ended: true },
        reason,
      });
    });
  }

  async invite(athleteId: string, guardianId: string, email: string, locale: Locale): Promise<void> {
    await this.db.tx(async (tx) => {
      const g = await this.load(tx, athleteId, guardianId);
      if (g.guardianPerson.user) throw new DomainError('ALREADY_EXISTS', { resource: 'guardian_account' });
      await this.sendInvite(tx, athleteId, g.id, email, locale);
    });
  }

  /** В письме нет данных ребёнка (SECURITY.md, 3.7): только название клуба и ссылка. */
  private async sendInvite(
    tx: Tx,
    athleteId: string,
    guardianId: string,
    email: string,
    locale: Locale,
  ): Promise<void> {
    const club = await tx.athleteMembership.findFirst({
      where: { athleteId, ...currentPeriod() },
      orderBy: [{ isPrimary: 'desc' }, { validFrom: 'desc' }],
      include: { organization: { select: { name: true } } },
    });
    const payload: GuardianInvitePayload = { type: 'GUARDIAN', guardianId, email: email.toLowerCase() };
    const token = await this.tokens.issue(tx, 'INVITE', {
      userId: null,
      ttlSeconds: INVITE_TTL_SECONDS,
      payload: { ...payload },
    });
    await this.emails.request(tx, {
      template: 'guardian.invite',
      to: email,
      userId: null,
      locale,
      params: {
        organizationName: club?.organization.name ?? '—',
        acceptUrl: `${this.env.APP_URL.replace(/\/$/, '')}/${locale}/invites/guardian?token=${encodeURIComponent(token)}`,
      },
    });
    await this.audit.record(tx, {
      action: 'guardian.invited',
      entityType: 'Guardian',
      entityId: guardianId,
      after: { invitedEmail: email },
    });
  }

  /** Принять приглашение может только владелец приглашённого email, подтвердивший его. */
  async acceptInvite(user: AuthUser, token: string): Promise<MyAthlete[]> {
    await this.db.tx(async (tx) => {
      const consumed = await this.tokens.consume(tx, 'INVITE', token);
      if (!isGuardianPayload(consumed.payload)) throw new DomainError('TOKEN_EXPIRED');
      const payload = consumed.payload;
      const g = await tx.guardian.findFirst({ where: { id: payload.guardianId, endedAt: null } });
      if (!g) throw new DomainError('TOKEN_EXPIRED');
      if (!user.emailVerified || !user.email || user.email.toLowerCase() !== payload.email)
        throw new DomainError('FORBIDDEN', { reason: 'invite_email_mismatch' });
      const linked = await this.people.linkUser(tx, user.id, g.guardianPersonId);
      await this.audit.record(tx, {
        action: 'guardian.linked',
        entityType: 'Guardian',
        entityId: g.id,
        after: { userId: user.id, personId: linked.personId, mergedPersonId: linked.mergedFrom },
      });
    });
    const personId = (await this.db.user.findUniqueOrThrow({ where: { id: user.id } })).personId;
    return this.myAthletes({ ...user, personId });
  }

  /** «Мои спортсмены»: сам пользователь-спортсмен (SELF) и дети, где он представитель. */
  async myAthletes(user: AuthUser): Promise<MyAthlete[]> {
    if (!user.personId) return [];
    const include = {
      person: true,
      memberships: {
        where: currentPeriod(),
        orderBy: [{ isPrimary: 'desc' as const }, { validFrom: 'desc' as const }],
        include: { organization: { select: { shortName: true } } },
      },
    };
    const [self, guardianOf] = await Promise.all([
      this.db.athleteProfile.findUnique({ where: { personId: user.personId }, include }),
      this.db.guardian.findMany({
        where: { guardianPersonId: user.personId, endedAt: null, athlete: { status: { not: 'ARCHIVED' } } },
        include: { athlete: { include } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const rows = [
      ...(self ? [{ relation: 'SELF' as const, verified: true, athlete: self }] : []),
      ...guardianOf.map((g) => ({
        relation: 'GUARDIAN' as const,
        verified: g.verifiedAt !== null,
        athlete: g.athlete,
      })),
    ];
    const status = await this.extensions.consentsStatusOf(rows.map((r) => r.athlete.personId));
    return rows.map((r) => ({
      relation: r.relation,
      verified: r.verified,
      athleteId: r.athlete.id,
      publicName: publicName(r.athlete.person.lastName, r.athlete.person.firstName),
      birthYear: r.athlete.person.birthDate.getUTCFullYear(),
      clubShortName: r.athlete.memberships[0]?.organization.shortName ?? null,
      consentsStatus: r.verified ? (status.get(r.athlete.personId) ?? null) : null,
    }));
  }
}
