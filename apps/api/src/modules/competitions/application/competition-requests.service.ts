// Заявки организаций на проведение турнира (docs/RATED_ONLY.md, 2). Турнир создаёт только платформа: организация с
// `competition.request` подаёт заявку, администратор платформы (`competition.create_rated`) одобряет её — создаётся
// черновик рейтингового турнира по предложению организации — или отклоняет с причиной. Организация может отозвать
// заявку, пока её не рассмотрели. Каждая команда — одна транзакция с записью аудита.
import { Injectable } from '@nestjs/common';
import {
  CompetitionRequestProposal,
  type CompetitionRequestAction,
  type CompetitionRequestCreate,
  type CompetitionRequestDto,
  type CompetitionRequestsQuery,
  type CompetitionRequestStatus,
  type Page,
  ROLE_PERMISSIONS,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { OrganizationScopeService } from '../../organizations';
import { toDate } from './competition-edit';
import { CompetitionReferences } from './competition-references';
import { CompetitionsService } from './competitions.service';

const INCLUDE = {
  organization: { select: { id: true, name: true, shortName: true } },
  submittedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.CompetitionRequestInclude;

type Row = Prisma.CompetitionRequestGetPayload<{ include: typeof INCLUDE }>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class CompetitionRequestsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly refs: CompetitionReferences,
    private readonly competitions: CompetitionsService,
    private readonly audit: AuditService,
  ) {}

  private isPlatform(user: AuthUser): Promise<boolean> {
    return this.policy.can(user, 'competition.create_rated', { kind: 'PLATFORM' });
  }

  // ---------- Чтение ----------

  /** Платформа видит все заявки, организация — свои (где у пользователя есть `competition.request`). */
  async list(user: AuthUser, q: CompetitionRequestsQuery): Promise<Page<CompetitionRequestDto>> {
    const and: Prisma.CompetitionRequestWhereInput[] = [];
    const platform = await this.isPlatform(user);
    if (!platform) {
      const grants = await this.policy.grants(user);
      const own = grants.organizations
        .filter((g) => g.roles.some((r) => ROLE_PERMISSIONS[r]['competition.request'] !== undefined))
        .map((g) => g.organizationId);
      and.push({ organizationId: { in: own } });
    }
    if (q.status) and.push({ status: q.status });
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    const cursor = decodeCursor(q.cursor);
    if (cursor) and.push({ id: { lt: cursor.id } });
    const rows = await this.db.competitionRequest.findMany({
      where: { AND: and },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      include: INCLUDE,
    });
    const venues = await this.venues(rows);
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.id, id: r.id }),
      (r) => this.toDto(r, venues, this.actions(r, platform, !platform)),
    );
  }

  async get(user: AuthUser, id: string): Promise<CompetitionRequestDto> {
    const row = await this.db.competitionRequest.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    const platform = await this.isPlatform(user);
    const own =
      !platform &&
      (await this.policy.can(user, 'competition.request', await this.orgScopes.scopeOf(row.organizationId)));
    if (!platform && !own) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    return this.toDto(row, await this.venues([row]), this.actions(row, platform, own));
  }

  // ---------- Команды ----------

  async submit(user: AuthUser, input: CompetitionRequestCreate): Promise<CompetitionRequestDto> {
    const scope = await this.orgScopes.scopeOf(input.organizationId);
    await this.policy.assert(user, 'competition.request', scope);
    if (!scope.visibleToAll)
      throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: input.organizationId });
    const { organizationId, expectedParticipants, comment, ...rest } = input;
    const proposal = CompetitionRequestProposal.parse(rest);
    const id = await this.db.tx(async (tx) => {
      await this.refs.assertDiscipline(tx, proposal.disciplineCode);
      if (proposal.venueId) await this.refs.assertVenue(tx, proposal.venueId, organizationId);
      const created = await tx.competitionRequest.create({
        data: {
          id: uuidv7(),
          organizationId,
          submittedById: user.id,
          name: proposal.name,
          startDate: toDate(proposal.startDate),
          endDate: toDate(proposal.endDate),
          proposal,
          expectedParticipants: expectedParticipants ?? null,
          comment: comment || null,
        },
      });
      await this.audit.record(tx, {
        action: 'competition_request.submitted',
        entityType: 'CompetitionRequest',
        entityId: created.id,
        organizationId,
        after: { name: proposal.name, startDate: proposal.startDate, endDate: proposal.endDate },
      });
      return created.id;
    });
    return this.get(user, id);
  }

  async withdraw(user: AuthUser, id: string, version: number): Promise<CompetitionRequestDto> {
    const current = await this.require(id);
    await this.policy.assert(
      user,
      'competition.request',
      await this.orgScopes.scopeOf(current.organizationId),
    );
    await this.db.tx(async (tx) => {
      await this.lockPending(tx, id, version);
      await this.decide(tx, id, 'WITHDRAWN', user.id, null);
      await this.audit.record(tx, {
        action: 'competition_request.withdrawn',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: current.organizationId,
        before: { status: 'SUBMITTED' },
        after: { status: 'WITHDRAWN' },
      });
    });
    return this.get(user, id);
  }

  async reject(user: AuthUser, id: string, version: number, reason: string): Promise<CompetitionRequestDto> {
    await this.policy.assert(user, 'competition.create_rated', { kind: 'PLATFORM' });
    await this.db.tx(async (tx) => {
      const row = await this.lockPending(tx, id, version);
      await this.decide(tx, id, 'REJECTED', user.id, reason);
      await this.audit.record(tx, {
        action: 'competition_request.rejected',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: row.organizationId,
        before: { status: 'SUBMITTED' },
        after: { status: 'REJECTED' },
        reason,
        platformIntervention: true,
      });
    });
    return this.get(user, id);
  }

  /**
   * Одобрение: черновик рейтингового турнира по предложению организации, организатор — она же; автор заявки ведёт
   * турнир (при необходимости — руководителем турнира). Сроки, место и правила соревнований правятся уже в турнире;
   * проверка сроков — при публикации.
   */
  async approve(user: AuthUser, id: string, version: number): Promise<CompetitionRequestDto> {
    await this.policy.assert(user, 'competition.create_rated', { kind: 'PLATFORM' });
    await this.db.tx(async (tx) => {
      const row = await this.lockPending(tx, id, version);
      const scope = await this.orgScopes.scopeOf(row.organizationId);
      if (!scope.visibleToAll)
        throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: row.organizationId });
      const proposal = CompetitionRequestProposal.parse(row.proposal);
      const competitionId = await this.competitions.insert(
        tx,
        user,
        { ...proposal, organizerOrganizationId: row.organizationId },
        { requestId: id },
      );
      const submitter = await tx.competitionRequest.findUniqueOrThrow({
        where: { id },
        select: { submittedById: true },
      });
      // Автор заявки ведёт свой турнир: руководитель турнира, если ролью в организации он им не управляет.
      const manager = submitter.submittedById
        ? await this.competitions.grantManagerIfNeeded(
            tx,
            competitionId,
            row.organizationId,
            submitter.submittedById,
            user.id,
          )
        : false;
      await this.decide(tx, id, 'APPROVED', user.id, null, competitionId);
      await this.audit.record(tx, {
        action: 'competition_request.approved',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: row.organizationId,
        competitionId,
        before: { status: 'SUBMITTED' },
        after: { status: 'APPROVED', competitionId, managerGranted: manager },
        platformIntervention: true,
      });
    });
    return this.get(user, id);
  }

  // ---------- Внутреннее ----------

  private async require(id: string): Promise<{ organizationId: string }> {
    const row = await this.db.competitionRequest.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    return row;
  }

  /** Заявка на рассмотрении с ожидаемой версией, под блокировкой строки. */
  private async lockPending(
    tx: Tx,
    id: string,
    version: number,
  ): Promise<{ organizationId: string; proposal: unknown }> {
    const [row] = await tx.$queryRaw<
      { organization_id: string; status: CompetitionRequestStatus; version: number; proposal: unknown }[]
    >`SELECT organization_id, status, version, proposal FROM competition_request WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    if (row.version !== version) throw versionConflict(row.version);
    if (row.status !== 'SUBMITTED')
      throw new DomainError('COMPETITION_REQUEST_NOT_PENDING', { status: row.status });
    return { organizationId: row.organization_id, proposal: row.proposal };
  }

  private async decide(
    tx: Tx,
    id: string,
    status: CompetitionRequestStatus,
    userId: string,
    reason: string | null,
    competitionId: string | null = null,
  ): Promise<void> {
    await tx.competitionRequest.update({
      where: { id },
      data: {
        status,
        decisionReason: reason,
        decidedById: userId,
        decidedAt: new Date(),
        competitionId,
        version: { increment: 1 },
      },
    });
  }

  private actions(row: Row, platform: boolean, own: boolean): CompetitionRequestAction[] {
    if (row.status !== 'SUBMITTED') return [];
    const actions: CompetitionRequestAction[] = [];
    if (platform) actions.push('approve', 'reject');
    if (own) actions.push('withdraw');
    return actions;
  }

  private async venues(rows: Row[]): Promise<Map<string, CompetitionRequestDto['venue']>> {
    const ids = [
      ...new Set(
        rows
          .map((r) => CompetitionRequestProposal.safeParse(r.proposal))
          .flatMap((p) => (p.success && p.data.venueId ? [p.data.venueId] : [])),
      ),
    ];
    if (ids.length === 0) return new Map();
    const venues = await this.db.venue.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, address: true, city: true },
    });
    return new Map(venues.map((v) => [v.id, v]));
  }

  private toDto(
    row: Row,
    venues: Map<string, CompetitionRequestDto['venue']>,
    allowedActions: CompetitionRequestAction[],
  ): CompetitionRequestDto {
    const proposal = CompetitionRequestProposal.parse(row.proposal);
    return {
      id: row.id,
      status: row.status,
      organization: row.organization,
      submittedBy: row.submittedBy,
      name: row.name,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
      level: proposal.level,
      venue: proposal.venueId ? (venues.get(proposal.venueId) ?? null) : null,
      proposal,
      expectedParticipants: row.expectedParticipants,
      comment: row.comment,
      decisionReason: row.decisionReason,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      competitionId: row.competitionId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions,
    };
  }
}
