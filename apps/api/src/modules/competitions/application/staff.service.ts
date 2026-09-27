// Персонал турнира (API.md, 5.1; D-07): приглашение по email или пользователю, принятие, приостановка.
// Роль действует только после принятия приглашения владельцем подтверждённого email.
import { Inject, Injectable } from '@nestjs/common';
import {
  type CompetitionMember,
  type CompetitionMemberInvite,
  type CompetitionMemberPatch,
  type CompetitionMembersQuery,
  isRoleCode,
  type Locale,
  type Page,
  type RoleCode,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { Env } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { INVITE_TTL_SECONDS, VerificationTokenService } from '../../auth';
import { EmailRequestService } from '../../outbox';
import { selfAssignment, staffTransitionAllowed, staffTransitionsFrom } from '../domain/staff-rules';
import { CompetitionScopeService } from './competition-scope.service';

const INCLUDE = {
  role: { select: { code: true } },
  user: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.CompetitionMembershipInclude;
type Row = Prisma.CompetitionMembershipGetPayload<{ include: typeof INCLUDE }>;

function toDto(m: Row): CompetitionMember {
  return {
    id: m.id,
    competitionId: m.competitionId,
    user: m.user,
    invitedEmail: m.userId ? null : m.invitedEmail,
    roleCode: m.role.code as RoleCode,
    status: m.status,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly db: PrismaService,
    private readonly scopes: CompetitionScopeService,
    private readonly audit: AuditService,
    private readonly tokens: VerificationTokenService,
    private readonly emails: EmailRequestService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(competitionId: string, q: CompetitionMembersQuery): Promise<Page<CompetitionMember>> {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.competitionMembership.findMany({
      where: {
        competitionId,
        status: q.status,
        role: q.role ? { code: q.role } : undefined,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: new Date(cursor.k) } },
                { createdAt: new Date(cursor.k), id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: INCLUDE,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }), toDto);
  }

  async invite(
    user: AuthUser,
    competitionId: string,
    req: CompetitionMemberInvite,
    locale: Locale,
  ): Promise<CompetitionMember> {
    const competition = await this.scopes.require(competitionId);
    if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(competition.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
    const email = await this.inviteeEmail(req);
    if (selfAssignment(user, { userId: req.userId, email }))
      throw new DomainError('FORBIDDEN', { reason: 'self_assignment' });
    const created = await this.db.tx(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: req.roleCode } });
      const existing = await tx.competitionMembership.findFirst({
        where: {
          competitionId,
          roleId: role.id,
          status: { in: ['INVITED', 'ACTIVE', 'SUSPENDED'] },
          OR: [{ invitedEmail: email }, { user: { email } }],
        },
      });
      if (existing) throw new DomainError('ALREADY_EXISTS', { resource: 'competition_membership' });
      const membership = await tx.competitionMembership.create({
        data: {
          id: uuidv7(),
          competitionId,
          invitedEmail: email,
          roleId: role.id,
          status: 'INVITED',
          invitedById: user.id,
        },
        include: INCLUDE,
      });
      await this.sendInvite(tx, membership.id, email, locale, {
        competitionName: competition.name,
        roleCode: req.roleCode,
      });
      await this.audit.record(tx, {
        action: 'competition.member_invited',
        entityType: 'CompetitionMembership',
        entityId: membership.id,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        after: { roleCode: req.roleCode, status: 'INVITED', invitedEmail: email },
      });
      return membership;
    });
    return toDto(created);
  }

  /** Email приглашённого: указанный или email существующего активного пользователя. */
  private async inviteeEmail(req: CompetitionMemberInvite): Promise<string> {
    if (!req.userId) {
      if (!req.email)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'email', code: 'required' }] });
      return req.email;
    }
    const target = await this.db.user.findFirst({
      where: { id: req.userId, status: 'ACTIVE', deletedAt: null },
      select: { email: true },
    });
    if (!target?.email)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'userId', code: 'not_found' }] });
    return target.email;
  }

  /** Одноразовая ссылка приглашения письмом (outbox): принять — после входа с этим email. */
  private async sendInvite(
    tx: Tx,
    membershipId: string,
    email: string,
    locale: Locale,
    params: { competitionName: string; roleCode: string },
  ): Promise<void> {
    const token = await this.tokens.issue(tx, 'INVITE', {
      userId: null,
      ttlSeconds: INVITE_TTL_SECONDS,
      payload: { competitionMembershipId: membershipId },
    });
    const base = this.env.APP_URL.replace(/\/$/, '');
    await this.emails.request(tx, {
      template: 'competition.invite',
      to: email,
      userId: null,
      locale,
      params: {
        ...params,
        acceptUrl: `${base}/${locale}/invites/competition?token=${encodeURIComponent(token)}`,
      },
    });
  }

  /** Принять приглашение может только владелец приглашённого email, подтвердивший его. */
  async accept(user: AuthUser, token: string): Promise<CompetitionMember> {
    const accepted = await this.db.tx(async (tx) => {
      const consumed = await this.tokens.consume(tx, 'INVITE', token);
      const payload = consumed.payload as { competitionMembershipId?: unknown } | null;
      const id =
        typeof payload?.competitionMembershipId === 'string' ? payload.competitionMembershipId : null;
      const membership = id
        ? await tx.competitionMembership.findUnique({ where: { id }, include: INCLUDE })
        : null;
      if (!membership || membership.status !== 'INVITED') throw new DomainError('TOKEN_EXPIRED');
      if (
        !user.emailVerified ||
        !user.email ||
        user.email.toLowerCase() !== membership.invitedEmail?.toLowerCase()
      )
        throw new DomainError('FORBIDDEN', { reason: 'invite_email_mismatch' });
      const duplicate = await tx.competitionMembership.findFirst({
        where: {
          competitionId: membership.competitionId,
          userId: user.id,
          roleId: membership.roleId,
          status: { in: ['INVITED', 'ACTIVE'] },
        },
      });
      if (duplicate) throw new DomainError('ALREADY_EXISTS', { resource: 'competition_membership' });
      const updated = await tx.competitionMembership.update({
        where: { id: membership.id },
        data: { userId: user.id, status: 'ACTIVE', version: { increment: 1 } },
        include: INCLUDE,
      });
      await tx.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'competition.member_joined',
        entityType: 'CompetitionMembership',
        entityId: membership.id,
        competitionId: membership.competitionId,
        before: { status: 'INVITED' },
        after: { status: 'ACTIVE', userId: user.id },
      });
      return updated;
    });
    return toDto(accepted);
  }

  async update(
    user: AuthUser,
    competitionId: string,
    membershipId: string,
    version: number,
    patch: CompetitionMemberPatch,
  ): Promise<CompetitionMember> {
    const current = await this.db.competitionMembership.findFirst({
      where: { id: membershipId, competitionId },
      include: INCLUDE,
    });
    if (!current || !isRoleCode(current.role.code))
      throw new DomainError('NOT_FOUND', { resource: 'competition_membership' });
    if (current.userId === user.id) throw new DomainError('FORBIDDEN', { reason: 'self_assignment' });
    if (patch.status !== current.status && !staffTransitionAllowed(current.status, patch.status))
      throw new DomainError('INVALID_TRANSITION', {
        from: current.status,
        to: patch.status,
        allowed: staffTransitionsFrom(current.status),
      });
    const updated = await this.db.tx(async (tx) => {
      const { count } = await tx.competitionMembership.updateMany({
        where: { id: membershipId, version },
        data: { status: patch.status, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version);
      if (current.userId)
        await tx.user.update({
          where: { id: current.userId },
          data: { permissionsVersion: { increment: 1 } },
        });
      await this.audit.record(tx, {
        action: 'competition.member_updated',
        entityType: 'CompetitionMembership',
        entityId: membershipId,
        competitionId,
        before: { status: current.status },
        after: { status: patch.status },
      });
      return tx.competitionMembership.findUniqueOrThrow({ where: { id: membershipId }, include: INCLUDE });
    });
    return toDto(updated);
  }
}
