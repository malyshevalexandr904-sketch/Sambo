// Открытый набор судей (правки 27.10.2026): организатор объявляет должности персонала турнира с требованиями
// (при создании турнира или на его странице), судья в роли кабинета «Судья» видит открытые наборы и подаёт заявку на
// должность, организатор одобряет заявку — судья становится персоналом турнира в этой роли — или отклоняет её.
// Права организатора — `competition.members.manage` в турнире (как у приглашения персонала).
import { Injectable } from '@nestjs/common';
import {
  type OpenRefereeRecruitmentDto,
  type RefereeApplicationDecision,
  type RefereeApplicationDto,
  type RefereeRecruitmentPositionDto,
  type RefereeRecruitmentPositionInput,
  type RefereeRecruitmentPositionPatch,
  type RoleCode,
  type CompetitionStatus,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { selfAssignment } from '../domain/staff-rules';
import { CompetitionScopeService } from './competition-scope.service';

/** Набор идёт, пока турнир не завершён и не отменён. */
const CLOSED_COMPETITION: CompetitionStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];

const APPLICATION_INCLUDE = {
  user: {
    select: {
      id: true,
      displayName: true,
      email: true,
      person: {
        select: {
          refereeProfile: { select: { category: { select: { code: true, nameRu: true, nameEn: true } } } },
        },
      },
    },
  },
} satisfies Prisma.RefereeRecruitmentApplicationInclude;
type ApplicationRow = Prisma.RefereeRecruitmentApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

function applicationDto(a: ApplicationRow): RefereeApplicationDto {
  const category = a.user.person?.refereeProfile?.category ?? null;
  return {
    id: a.id,
    positionId: a.positionId,
    status: a.status,
    applicant: { id: a.user.id, displayName: a.user.displayName, email: a.user.email },
    refereeCategory: category
      ? { code: category.code, name: { ru: category.nameRu, en: category.nameEn } }
      : null,
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    version: a.version,
  };
}

@Injectable()
export class RefereeRecruitmentService {
  constructor(
    private readonly db: PrismaService,
    private readonly scopes: CompetitionScopeService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Организатор ----------

  /** Должности набора при создании турнира (в транзакции создания). */
  async insertPositions(
    tx: Tx,
    competition: { id: string; organizerOrganizationId: string },
    positions: readonly RefereeRecruitmentPositionInput[],
    userId: string,
  ): Promise<void> {
    for (const p of positions) await this.createPosition(tx, competition, p, userId);
  }

  async listForCompetition(competitionId: string): Promise<RefereeRecruitmentPositionDto[]> {
    const rows = await this.db.refereeRecruitmentPosition.findMany({
      where: { competitionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        role: { select: { code: true } },
        applications: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: APPLICATION_INCLUDE },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      competitionId: p.competitionId,
      roleCode: p.role.code as RoleCode,
      requirements: p.requirements,
      status: p.status,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
      applications: p.applications.map(applicationDto),
    }));
  }

  async addPosition(
    user: AuthUser,
    competitionId: string,
    input: RefereeRecruitmentPositionInput,
  ): Promise<RefereeRecruitmentPositionDto[]> {
    const competition = await this.scopes.require(competitionId);
    if (CLOSED_COMPETITION.includes(competition.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
    await this.db.tx((tx) => this.createPosition(tx, competition, input, user.id));
    return this.listForCompetition(competitionId);
  }

  /** Закрыть набор на должность или открыть снова; поданные заявки остаются. */
  async updatePosition(
    competitionId: string,
    positionId: string,
    version: number,
    patch: RefereeRecruitmentPositionPatch,
  ): Promise<RefereeRecruitmentPositionDto[]> {
    const competition = await this.scopes.require(competitionId);
    await this.db.tx(async (tx) => {
      const current = await tx.refereeRecruitmentPosition.findFirst({
        where: { id: positionId, competitionId },
      });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'referee_recruitment_position' });
      if (patch.status === 'OPEN' && CLOSED_COMPETITION.includes(competition.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
      const { count } = await tx.refereeRecruitmentPosition.updateMany({
        where: { id: positionId, version },
        data: { status: patch.status, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version);
      await this.audit.record(tx, {
        action: 'competition.recruitment_position_updated',
        entityType: 'RefereeRecruitmentPosition',
        entityId: positionId,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        before: { status: current.status },
        after: { status: patch.status },
      });
    });
    return this.listForCompetition(competitionId);
  }

  /**
   * Решение по заявке. Одобрение — судья становится персоналом турнира в роли должности (сразу действующая роль:
   * он сам подал заявку); свою заявку организатор не рассматривает.
   */
  async decide(
    user: AuthUser,
    competitionId: string,
    applicationId: string,
    version: number,
    body: RefereeApplicationDecision,
  ): Promise<RefereeRecruitmentPositionDto[]> {
    const competition = await this.scopes.require(competitionId);
    await this.db.tx(async (tx) => {
      const application = await tx.refereeRecruitmentApplication.findFirst({
        where: { id: applicationId, position: { competitionId } },
        include: { position: true, user: { select: { id: true, email: true } } },
      });
      if (!application) throw new DomainError('NOT_FOUND', { resource: 'referee_application' });
      if (application.status !== 'PENDING')
        throw new DomainError('INVALID_TRANSITION', {
          from: application.status,
          to: body.decision,
          allowed: [],
        });
      if (selfAssignment(user, { userId: application.userId, email: application.user.email }))
        throw new DomainError('FORBIDDEN', { reason: 'self_assignment' });
      const status = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const { count } = await tx.refereeRecruitmentApplication.updateMany({
        where: { id: applicationId, version },
        data: { status, decidedById: user.id, decidedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(application.version);
      let membershipId: string | null = null;
      if (status === 'APPROVED') {
        if (CLOSED_COMPETITION.includes(competition.status))
          throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
        const existing = await tx.competitionMembership.findFirst({
          where: {
            competitionId,
            roleId: application.position.roleId,
            userId: application.userId,
            status: { in: ['INVITED', 'ACTIVE', 'SUSPENDED'] },
          },
          select: { id: true },
        });
        if (!existing) {
          membershipId = uuidv7();
          await tx.competitionMembership.create({
            data: {
              id: membershipId,
              competitionId,
              userId: application.userId,
              invitedEmail: application.user.email,
              roleId: application.position.roleId,
              status: 'ACTIVE',
              invitedById: user.id,
            },
          });
          await tx.user.update({
            where: { id: application.userId },
            data: { permissionsVersion: { increment: 1 } },
          });
        }
      }
      await this.audit.record(tx, {
        action: 'competition.referee_application_decided',
        entityType: 'RefereeRecruitmentApplication',
        entityId: applicationId,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        before: { status: 'PENDING' },
        after: { status, ...(membershipId ? { membershipId } : {}) },
      });
    });
    return this.listForCompetition(competitionId);
  }

  // ---------- Судья ----------

  /** Открытые наборы для судьи: турниры, должности, требования и его заявки. Только в роли кабинета «Судья». */
  async listOpen(user: AuthUser): Promise<OpenRefereeRecruitmentDto[]> {
    this.assertReferee(user);
    const rows = await this.db.refereeRecruitmentPosition.findMany({
      where: {
        status: 'OPEN',
        competition: { deletedAt: null, status: { notIn: CLOSED_COMPETITION } },
      },
      orderBy: [{ competition: { startDate: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      include: {
        role: { select: { code: true } },
        applications: { where: { userId: user.id }, select: { id: true, status: true } },
        competition: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            status: true,
            organizer: { select: { id: true, name: true, shortName: true } },
            venue: { select: { id: true, name: true, address: true, city: true } },
          },
        },
      },
    });
    const byCompetition = new Map<string, OpenRefereeRecruitmentDto>();
    for (const p of rows) {
      const c = p.competition;
      let item = byCompetition.get(c.id);
      if (!item) {
        item = {
          competition: {
            id: c.id,
            name: c.name,
            startDate: dateOnly(c.startDate),
            endDate: dateOnly(c.endDate),
            status: c.status,
            organizer: c.organizer,
            venue: c.venue,
          },
          positions: [],
        };
        byCompetition.set(c.id, item);
      }
      const mine = p.applications[0];
      item.positions.push({
        id: p.id,
        roleCode: p.role.code as RoleCode,
        requirements: p.requirements,
        myApplication: mine ? { id: mine.id, status: mine.status } : null,
      });
    }
    return [...byCompetition.values()];
  }

  /** Заявка судьи на должность: одна на должность, только пока набор открыт. */
  async apply(user: AuthUser, positionId: string): Promise<OpenRefereeRecruitmentDto[]> {
    this.assertReferee(user);
    await this.db.tx(async (tx) => {
      const position = await tx.refereeRecruitmentPosition.findUnique({
        where: { id: positionId },
        include: {
          competition: { select: { status: true, deletedAt: true, organizerOrganizationId: true } },
        },
      });
      if (!position || position.competition.deletedAt)
        throw new DomainError('NOT_FOUND', { resource: 'referee_recruitment_position' });
      if (position.status !== 'OPEN' || CLOSED_COMPETITION.includes(position.competition.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['recruitment_closed'] });
      const existing = await tx.refereeRecruitmentApplication.findUnique({
        where: { positionId_userId: { positionId, userId: user.id } },
        select: { id: true },
      });
      if (existing) throw new DomainError('ALREADY_EXISTS', { resource: 'referee_application' });
      const id = uuidv7();
      await tx.refereeRecruitmentApplication.create({ data: { id, positionId, userId: user.id } });
      await this.audit.record(tx, {
        action: 'competition.referee_applied',
        entityType: 'RefereeRecruitmentApplication',
        entityId: id,
        competitionId: position.competitionId,
        organizationId: position.competition.organizerOrganizationId,
        after: { positionId, status: 'PENDING' },
      });
    });
    return this.listOpen(user);
  }

  // ---------- Внутреннее ----------

  private assertReferee(user: AuthUser): void {
    if (user.activeRole !== 'REFEREE')
      throw new DomainError('FORBIDDEN', { reason: 'referee_role_required' });
  }

  private async createPosition(
    tx: Tx,
    competition: { id: string; organizerOrganizationId: string },
    input: RefereeRecruitmentPositionInput,
    userId: string,
  ): Promise<void> {
    const role = await tx.role.findUniqueOrThrow({ where: { code: input.roleCode }, select: { id: true } });
    const id = uuidv7();
    await tx.refereeRecruitmentPosition.create({
      data: {
        id,
        competitionId: competition.id,
        roleId: role.id,
        requirements: input.requirements,
        createdById: userId,
      },
    });
    await this.audit.record(tx, {
      action: 'competition.recruitment_position_created',
      entityType: 'RefereeRecruitmentPosition',
      entityId: id,
      competitionId: competition.id,
      organizationId: competition.organizerOrganizationId,
      after: { roleCode: input.roleCode, status: 'OPEN' },
    });
  }
}
