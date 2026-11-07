// Персонал турнира (API.md, 5.1; D-07): приглашение пользователя платформы, ответ на него, приостановка.
// Правки 07.11.2026, п. 15: приглашают найденного по ФИО пользователя, приглашение приходит уведомлением на платформе
// (не письмом); роль действует после того, как приглашённый её примет. Ссылки из прежних писем принимаются (`accept`).
import { Injectable } from '@nestjs/common';
import {
  type CompetitionMember,
  type CompetitionMemberInvite,
  type CompetitionMemberPatch,
  type CompetitionMembersQuery,
  cabinetRoleOf,
  isRoleCode,
  type MyCompetitionInviteDto,
  type Page,
  type RoleCode,
} from '@sde/contracts';
import { type Prisma, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CabinetRolesService } from '../../access';
import { AuditService } from '../../audit';
import { VerificationTokenService } from '../../auth';
import { OutboxService } from '../../outbox';
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
    private readonly outbox: OutboxService,
    private readonly cabinetRoles: CabinetRolesService,
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

  /**
   * Приглашение в персонал (правки 07.11.2026, п. 15): зарегистрированного пользователя — по выбору из поиска по ФИО.
   * Письмо не отправляется: приглашённый получает уведомление на платформе и отвечает в кабинете («Приглашения»).
   */
  async invite(
    user: AuthUser,
    competitionId: string,
    req: CompetitionMemberInvite,
  ): Promise<CompetitionMember> {
    const competition = await this.scopes.require(competitionId);
    if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(competition.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
    const target = await this.db.user.findFirst({
      where: { id: req.userId, status: 'ACTIVE', deletedAt: null, isDemo: false },
      select: { id: true, email: true },
    });
    if (!target)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'userId', code: 'not_found' }] });
    if (selfAssignment(user, { userId: target.id, email: target.email }))
      throw new DomainError('FORBIDDEN', { reason: 'self_assignment' });
    const created = await this.db.tx(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: req.roleCode } });
      const existing = await tx.competitionMembership.findFirst({
        where: {
          competitionId,
          roleId: role.id,
          status: { in: ['INVITED', 'ACTIVE', 'SUSPENDED'] },
          OR: [{ userId: target.id }, ...(target.email ? [{ invitedEmail: target.email }] : [])],
        },
      });
      if (existing) throw new DomainError('ALREADY_EXISTS', { resource: 'competition_membership' });
      const membership = await tx.competitionMembership.create({
        data: {
          id: uuidv7(),
          competitionId,
          userId: target.id,
          invitedEmail: target.email,
          roleId: role.id,
          status: 'INVITED',
          invitedById: user.id,
        },
        include: INCLUDE,
      });
      await this.outbox.enqueue(tx, {
        type: 'competition.member_invited',
        aggregate: { type: 'CompetitionMembership', id: membership.id },
        competitionId,
        payload: { membershipId: membership.id, competitionId, userId: target.id, roleCode: req.roleCode },
      });
      await this.audit.record(tx, {
        action: 'competition.member_invited',
        entityType: 'CompetitionMembership',
        entityId: membership.id,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        after: { roleCode: req.roleCode, status: 'INVITED', userId: target.id },
      });
      return membership;
    });
    return toDto(created);
  }

  /** Приглашения пользователю, ждущие его ответа (правки 07.11.2026, п. 15). */
  async myInvites(user: AuthUser): Promise<MyCompetitionInviteDto[]> {
    const rows = await this.db.competitionMembership.findMany({
      where: {
        userId: user.id,
        status: 'INVITED',
        competition: { deletedAt: null, status: { notIn: ['FINISHED', 'ARCHIVED', 'CANCELLED'] } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        createdAt: true,
        role: { select: { code: true } },
        invitedBy: { select: { displayName: true } },
        competition: { select: { id: true, name: true, startDate: true, endDate: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      roleCode: r.role.code as RoleCode,
      competition: {
        id: r.competition.id,
        name: r.competition.name,
        startDate: r.competition.startDate.toISOString().slice(0, 10),
        endDate: r.competition.endDate.toISOString().slice(0, 10),
      },
      invitedBy: r.invitedBy?.displayName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Ответ на приглашение на платформе: принять (роль начинает действовать) или отказаться. */
  async respond(user: AuthUser, membershipId: string, accept: boolean): Promise<CompetitionMember> {
    const updated = await this.db.tx(async (tx) => {
      const m = await tx.competitionMembership.findUnique({ where: { id: membershipId }, include: INCLUDE });
      if (!m || m.userId !== user.id)
        throw new DomainError('NOT_FOUND', { resource: 'competition_membership' });
      if (m.status !== 'INVITED')
        throw new DomainError('INVALID_TRANSITION', { from: m.status, to: 'ACTIVE' });
      const row = await tx.competitionMembership.update({
        where: { id: m.id },
        data: { status: accept ? 'ACTIVE' : 'ENDED', version: { increment: 1 } },
        include: INCLUDE,
      });
      if (accept)
        await tx.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, {
        action: accept ? 'competition.member_joined' : 'competition.member_declined',
        entityType: 'CompetitionMembership',
        entityId: m.id,
        competitionId: m.competitionId,
        before: { status: 'INVITED' },
        after: { status: accept ? 'ACTIVE' : 'ENDED', userId: user.id },
      });
      return row;
    });
    if (accept && isRoleCode(updated.role.code))
      await this.cabinetRoles.selectIfHeld(user.id, user.sessionId, cabinetRoleOf(updated.role.code));
    return toDto(updated);
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
    // Принял приглашение — сессия переходит в роль кабинета этой роли (0.13.0): сразу открывается то, куда звали.
    if (isRoleCode(accepted.role.code))
      await this.cabinetRoles.selectIfHeld(user.id, user.sessionId, cabinetRoleOf(accepted.role.code));
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
