// Заявки клубов на турнир (API.md, 5.3; ARCHITECTURE.md, 16.3): создание, подача, рассмотрение, возврат на
// исправление, одобрение и отклонение. Решения по участникам — в EntryDecisionsService.
import { Injectable } from '@nestjs/common';
import {
  type ApplicationCreate,
  type ApplicationDto,
  type ApplicationPatch,
  type ApplicationsQuery,
  type ApplicationSummary,
  type ApplicationTransitionRequest,
  type MyApplicationsQuery,
  type Page,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import {
  type CompetitionBasics,
  CompetitionScopeService,
  registrationWindow,
  resubmissionAllowed,
} from '../../competitions';
import { OutboxService } from '../../outbox';
import {
  applicationTransitionsFrom,
  findApplicationTransition,
  isEditableByOwner,
  isUnderStaffReview,
} from '../domain/application-machine';
import { type ApplicationContext, RegistrationAccessService } from './registration-access.service';
import {
  applicationCursorWhere,
  applicationEvents,
  applyToEntries,
  currentPeriod,
  entryCounts,
} from './application-effects';
import { EntriesService } from './entries.service';
import { assertWindowOpen } from './entry-commands';
import {
  APPLICATION_INCLUDE,
  type ApplicationRow,
  EMPTY_COUNTS,
  toApplicationSummary,
} from './registration-mapper';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly coaches: CoachesService,
    private readonly entries: EntriesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Чтение ----------

  /** Действия над заявкой: переходы владельца и персонала, доступные сейчас. */
  private async actions(
    user: AuthUser,
    a: ApplicationRow,
    competition: CompetitionBasics,
    role: { owner: boolean; staff: boolean },
  ): Promise<string[]> {
    const actions: string[] = [];
    const scope = await this.competitions.scopeFor(competition);
    const window = registrationWindow(competition, new Date());
    for (const t of applicationTransitionsFrom(a.status)) {
      if (t.actor === 'OWNER' && !role.owner) continue;
      if (t.actor === 'STAFF' && !(t.permission && (await this.policy.can(user, t.permission, scope))))
        continue;
      if (t.to === 'SUBMITTED' && a.status === 'DRAFT' && window !== 'OPEN') continue;
      if (
        t.to === 'SUBMITTED' &&
        a.status === 'WAITING_DOCUMENTS' &&
        !resubmissionAllowed(competition.status)
      )
        continue;
      actions.push(`transition:${t.to}`);
    }
    if (role.owner && isEditableByOwner(a.status)) {
      actions.push('application.update');
      if (window === 'OPEN') actions.push('entry.create');
    }
    if (isUnderStaffReview(a.status)) {
      if (await this.policy.can(user, 'registration.approve', scope)) actions.push('entry.approve');
      if (await this.policy.can(user, 'registration.reject', scope)) actions.push('entry.reject');
    }
    return actions;
  }

  private async summaries(user: AuthUser, rows: ApplicationRow[]): Promise<ApplicationSummary[]> {
    const counts = await entryCounts(
      this.db,
      rows.map((r) => r.id),
    );
    const result: ApplicationSummary[] = [];
    for (const r of rows) {
      const competition = await this.competitions.require(r.competitionId);
      const role = {
        owner: await this.access.isOwner(user, r.organizationId),
        staff: await this.policy.can(
          user,
          'registration.view',
          await this.competitions.scopeFor(competition),
        ),
      };
      result.push(
        toApplicationSummary(
          r,
          counts.get(r.id) ?? EMPTY_COUNTS,
          await this.actions(user, r, competition, role),
        ),
      );
    }
    return result;
  }

  /** Очередь секретариата — поданные заявки турнира (без чужих черновиков); владельцу — свои. */
  async listForCompetition(
    user: AuthUser,
    competitionId: string,
    q: ApplicationsQuery,
  ): Promise<Page<ApplicationSummary>> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    const staff = await this.policy.can(user, 'registration.view', scope);
    if (!staff && competition.status === 'DRAFT') await this.policy.assert(user, 'registration.view', scope);
    const and: Prisma.ApplicationWhereInput[] = [
      { competitionId },
      await this.access.visibleApplications(user, staff),
    ];
    if (q.status) and.push({ status: q.status });
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    if (q.q)
      and.push({
        OR: [
          { organization: { name: { contains: q.q, mode: 'insensitive' } } },
          { organization: { shortName: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    and.push(applicationCursorWhere(decodeCursor(q.cursor)));
    const rows = await this.db.application.findMany({
      where: { AND: and },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: APPLICATION_INCLUDE,
    });
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.updatedAt.toISOString(), id: r.id }),
      (r) => r,
    );
    return { data: await this.summaries(user, page.data), page: page.page };
  }

  /** Заявки организаций пользователя по всем турнирам (кабинет тренера и клуба). */
  async listMine(user: AuthUser, q: MyApplicationsQuery): Promise<Page<ApplicationSummary>> {
    const own = await this.access.ownerOrganizations(user);
    const and: Prisma.ApplicationWhereInput[] = [];
    if (own !== 'all') and.push({ organizationId: { in: own } });
    if (q.competitionId) and.push({ competitionId: q.competitionId });
    if (q.status) and.push({ status: q.status });
    and.push({ competition: { deletedAt: null } });
    and.push(applicationCursorWhere(decodeCursor(q.cursor)));
    const rows = await this.db.application.findMany({
      where: { AND: and },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: APPLICATION_INCLUDE,
    });
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.updatedAt.toISOString(), id: r.id }),
      (r) => r,
    );
    return { data: await this.summaries(user, page.data), page: page.page };
  }

  async get(user: AuthUser, id: string): Promise<ApplicationDto> {
    const ctx = await this.access.applicationContext(id);
    const role = await this.access.assertVisible(user, ctx);
    const row = await this.db.application.findUniqueOrThrow({ where: { id }, include: APPLICATION_INCLUDE });
    const counts = (await entryCounts(this.db, [id])).get(id) ?? EMPTY_COUNTS;
    const actions = await this.actions(user, row, ctx.competition, role);
    return {
      ...toApplicationSummary(row, counts, actions),
      representation: {
        organization: row.representationOrg,
        region: row.representationRegion
          ? {
              id: row.representationRegion.id,
              name: { ru: row.representationRegion.nameRu, en: row.representationRegion.nameEn },
            }
          : null,
      },
      entries: await this.entries.forApplication(user, ctx, role),
      canAddEntries: actions.includes('entry.create'),
    };
  }

  // ---------- Команды ----------

  /** Тренер заявки — тренер клуба; представительство — организация и регион с существующими записями. */
  private async assertReferences(
    tx: Tx,
    organizationId: string,
    input: { coachId?: string | null; representation?: ApplicationCreate['representation'] },
  ): Promise<void> {
    if (input.coachId) {
      const link = await tx.coachMembership.findFirst({
        where: { coachId: input.coachId, organizationId, ...currentPeriod() },
        select: { id: true },
      });
      if (!link)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'coachId', code: 'not_found' }] });
    }
    const repOrg = input.representation?.organizationId;
    if (
      repOrg &&
      !(await tx.organization.findFirst({ where: { id: repOrg, deletedAt: null }, select: { id: true } }))
    )
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'representation.organizationId', code: 'not_found' }],
      });
    const repRegion = input.representation?.regionId;
    if (repRegion && !(await tx.region.findUnique({ where: { id: repRegion }, select: { id: true } })))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'representation.regionId', code: 'not_found' }],
      });
  }

  /** Заявку подаёт организация с `registration.create` в окне регистрации опубликованного турнира. */
  async create(user: AuthUser, competitionId: string, input: ApplicationCreate): Promise<ApplicationDto> {
    const competition = await this.competitions.require(competitionId);
    if (competition.status === 'DRAFT') throw new DomainError('NOT_FOUND', { resource: 'competition' });
    const orgScope = await this.access.organizationScope(input.organizationId);
    await this.policy.assert(user, 'registration.create', orgScope);
    if (orgScope.kind === 'ORGANIZATION' && !orgScope.visibleToAll)
      throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: input.organizationId });
    assertWindowOpen(competition);
    const coachId = input.coachId ?? (await this.coaches.coachIdOfUser(user));
    const id = await this.db.tx(async (tx) => {
      await this.assertReferences(tx, input.organizationId, {
        coachId: input.coachId,
        representation: input.representation,
      });
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { regionId: true },
      });
      const coachInClub = coachId
        ? await tx.coachMembership.findFirst({
            where: { coachId, organizationId: input.organizationId, ...currentPeriod() },
          })
        : null;
      const created = await tx.application.create({
        data: {
          id: uuidv7(),
          competitionId,
          organizationId: input.organizationId,
          coachId: coachInClub ? coachId : null,
          representationOrganizationId: input.representation?.organizationId ?? input.organizationId,
          representationRegionId: input.representation?.regionId ?? org.regionId,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'application.created',
        entityType: 'Application',
        entityId: created.id,
        competitionId,
        organizationId: input.organizationId,
        after: { status: 'DRAFT' },
      });
      return created.id;
    });
    return this.get(user, id);
  }

  async update(
    user: AuthUser,
    id: string,
    version: number,
    patch: ApplicationPatch,
  ): Promise<ApplicationDto> {
    const ctx = await this.access.applicationContext(id);
    await this.access.assertOwner(user, ctx);
    await this.db.tx(async (tx) => {
      const current = await this.lock(tx, id, version);
      if (!isEditableByOwner(current.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['application_not_editable'] });
      await this.assertReferences(tx, current.organizationId, patch);
      await tx.application.update({
        where: { id },
        data: {
          coachId: patch.coachId,
          representationOrganizationId:
            patch.representation?.organizationId === undefined
              ? undefined
              : patch.representation.organizationId,
          representationRegionId:
            patch.representation?.regionId === undefined ? undefined : patch.representation.regionId,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'application.updated',
        entityType: 'Application',
        entityId: id,
        competitionId: current.competitionId,
        organizationId: current.organizationId,
        before: {
          coachId: current.coachId,
          representationOrganizationId: current.representationOrganizationId,
          representationRegionId: current.representationRegionId,
        },
        after: patch,
      });
    });
    return this.get(user, id);
  }

  private async lock(tx: Tx, id: string, version: number) {
    await tx.$queryRaw`SELECT id FROM application WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.application.findUniqueOrThrow({ where: { id } });
    if (current.version !== version) throw versionConflict(current.version);
    return current;
  }

  /**
   * Переход заявки. Владелец подаёт (в окне регистрации; возвращённую — до начала мандатной комиссии) и
   * отзывает её; персонал берёт в работу, возвращает на исправление, одобряет и отклоняет.
   */
  async transition(
    user: AuthUser,
    id: string,
    version: number,
    req: ApplicationTransitionRequest,
  ): Promise<ApplicationDto> {
    const ctx = await this.access.applicationContext(id);
    const from = ctx.application.status;
    const def = findApplicationTransition(from, req.to);
    if (!def)
      throw new DomainError('INVALID_TRANSITION', {
        from,
        to: req.to,
        allowed: applicationTransitionsFrom(from).map((t) => t.to),
      });
    let viaPlatform = false;
    if (def.actor === 'OWNER') await this.access.assertOwner(user, ctx);
    else if (def.permission) viaPlatform = await this.access.assertStaff(user, def.permission, ctx);
    const comment = req.comment?.trim() || null;
    if (def.commentRequired && !comment) throw new DomainError('REASON_REQUIRED');

    await this.db.tx(async (tx) => {
      const current = await this.lock(tx, id, version);
      if (current.status !== from) throw versionConflict(current.version);
      const competition = await this.competitions.require(current.competitionId);
      await this.preconditions(tx, ctx, competition, req.to);
      const now = new Date();
      const data: Prisma.ApplicationUncheckedUpdateInput = { status: req.to, version: { increment: 1 } };
      if (req.to === 'SUBMITTED') {
        data.submittedAt = now;
        data.submittedByUserId = user.id;
      }
      if (def.actor === 'STAFF') {
        data.reviewedAt = now;
        data.reviewedById = user.id;
        data.reviewComment = comment ?? (req.to === 'UNDER_REVIEW' ? current.reviewComment : null);
      }
      await tx.application.update({ where: { id }, data });
      await applyToEntries(tx, id, from, req.to, comment);
      await this.audit.record(tx, {
        action: 'application.status_changed',
        entityType: 'Application',
        entityId: id,
        competitionId: current.competitionId,
        organizationId: current.organizationId,
        before: { status: from },
        after: { status: req.to },
        reason: comment,
        platformIntervention: viaPlatform,
      });
      await applicationEvents(this.outbox, tx, id, current.competitionId, req.to);
    });
    return this.get(user, id);
  }

  private async preconditions(
    tx: Tx,
    ctx: ApplicationContext,
    competition: CompetitionBasics,
    to: string,
  ): Promise<void> {
    const from = ctx.application.status;
    if (to === 'SUBMITTED') {
      if (from === 'DRAFT') assertWindowOpen(competition);
      else if (!resubmissionAllowed(competition.status))
        throw new DomainError('REGISTRATION_CLOSED', {
          registrationEndsAt: competition.registrationEndsAt.toISOString(),
        });
      const active = await tx.entry.count({
        where: { applicationId: ctx.application.id, status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
      });
      if (active === 0) throw new DomainError('APPLICATION_EMPTY');
    }
    if (to === 'APPROVED') {
      const pending = await tx.entry.count({
        where: { applicationId: ctx.application.id, status: 'PENDING' },
      });
      if (pending > 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['entries_pending'], pending });
    }
  }
}
