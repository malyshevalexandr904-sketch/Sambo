// Участия (API.md, 5.3): добавление спортсмена в заявку со снимком (ADR-10), решения секретариата по каждому
// участнику, снятие и перевод в другую категорию. Инварианты раздела 53 — в сервисе и в БД (entry_active_uq).
import { Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  type AthleteEntryDto,
  type EntriesQuery,
  type EntryCreate,
  type EntryDecisionRequest,
  type EntryDto,
  type EntryTransferRequest,
  type EntryWithdrawRequest,
  type Page,
  type PermissionCode,
} from '@sde/contracts';
import { Prisma, type Tx, uuidv7 } from '@sde/db';
import { RequestContextStore, type AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService, AthleteExtensions, type AthleteRegistrationInfo } from '../../athletes';
import { AuditService } from '../../audit';
import { CompetitionCategoriesService, isActiveCategory, MERGEABLE } from '../../categories';
import { type CompetitionBasics, CompetitionScopeService, registrationWindow } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { isEditableByOwner, isUnderStaffReview } from '../domain/application-machine';
import { ACTIVE_ENTRY_STATUSES, buildSnapshot, decisionAllowed, isActiveEntry } from '../domain/entry-rules';
import { EligibilityService } from './eligibility.service';
import { type ApplicationContext, RegistrationAccessService } from './registration-access.service';
import { ENTRY_INCLUDE, type EntryRow, toEntryDto } from './registration-mapper';

const STAFF_ACTIONS: readonly PermissionCode[] = [
  'registration.view',
  'registration.approve',
  'registration.reject',
  'entry.withdraw',
  'entry.transfer',
];

/** Решения по участникам — до начала жеребьёвки: при регистрации и на мандатной комиссии. */
const DECISION_PHASE = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class EntriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly categories: CompetitionCategoriesService,
    private readonly eligibility: EligibilityService,
    private readonly athletes: AthleteAccessService,
    private readonly athleteExtensions: AthleteExtensions,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Чтение ----------

  private async actionsFactory(
    user: AuthUser,
    competition: CompetitionBasics,
  ): Promise<
    (e: EntryRow, appStatus: ApplicationStatus, owner: boolean, categoryStatus?: string) => string[]
  > {
    const scope = await this.competitions.scopeFor(competition);
    const perms = new Set(await this.policy.allowedActions(user, scope, STAFF_ACTIONS));
    const windowOpen = registrationWindow(competition, new Date()) === 'OPEN';
    return (e, appStatus, owner, categoryStatus) => {
      const a: string[] = [];
      if (owner && isEditableByOwner(appStatus) && e.status !== 'WITHDRAWN') {
        a.push('entry.delete');
        if (e.status !== 'APPROVED') a.push('entry.refresh_snapshot');
      }
      if (isUnderStaffReview(appStatus) && DECISION_PHASE.includes(competition.status)) {
        if (perms.has('registration.approve') && decisionAllowed(e.status, 'APPROVED'))
          a.push('entry.approve');
        if (perms.has('registration.reject') && decisionAllowed(e.status, 'REJECTED')) a.push('entry.reject');
      }
      if (isActiveEntry(e.status) && (perms.has('entry.withdraw') || (owner && windowOpen)))
        a.push('entry.withdraw');
      if (
        isActiveEntry(e.status) &&
        perms.has('entry.transfer') &&
        (!categoryStatus || MERGEABLE.includes(categoryStatus as (typeof MERGEABLE)[number]))
      )
        a.push('entry.transfer');
      return a;
    };
  }

  async forApplication(
    user: AuthUser,
    ctx: ApplicationContext,
    role: { owner: boolean },
  ): Promise<EntryDto[]> {
    const rows = await this.db.entry.findMany({
      where: { applicationId: ctx.application.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        ...ENTRY_INCLUDE,
        category: { select: { id: true, code: true, nameRu: true, nameEn: true, status: true } },
      },
    });
    const actions = await this.actionsFactory(user, ctx.competition);
    return rows.map((r) => toEntryDto(r, actions(r, ctx.application.status, role.owner, r.category.status)));
  }

  /** Участники турнира: персоналу — все, владельцу — участники заявок его организаций. */
  async listForCompetition(user: AuthUser, competitionId: string, q: EntriesQuery): Promise<Page<EntryDto>> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    const staff = await this.policy.can(user, 'registration.view', scope);
    if (!staff && competition.status === 'DRAFT') await this.policy.assert(user, 'registration.view', scope);
    const own = staff ? 'all' : await this.access.ownerOrganizations(user);
    const and: Prisma.EntryWhereInput[] = [{ competitionId }];
    if (own !== 'all') and.push({ application: { organizationId: { in: own } } });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.status) and.push({ status: q.status });
    if (q.organizationId) and.push({ application: { organizationId: q.organizationId } });
    if (q.applicationId) and.push({ applicationId: q.applicationId });
    if (q.q)
      and.push({
        OR: [
          { snapLastName: { contains: q.q, mode: 'insensitive' } },
          { snapFirstName: { contains: q.q, mode: 'insensitive' } },
          { snapClubName: { contains: q.q, mode: 'insensitive' } },
        ],
      });
    const cursor = decodeCursor(q.cursor);
    if (cursor)
      and.push({
        OR: [{ snapLastName: { gt: cursor.k } }, { snapLastName: cursor.k, id: { gt: cursor.id } }],
      });
    const rows = await this.db.entry.findMany({
      where: { AND: and },
      orderBy: [{ snapLastName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: {
        ...ENTRY_INCLUDE,
        category: { select: { id: true, code: true, nameRu: true, nameEn: true, status: true } },
        application: {
          select: { status: true, organization: { select: { id: true, name: true, shortName: true } } },
        },
      },
    });
    const actions = await this.actionsFactory(user, competition);
    const owners = new Map<string, boolean>();
    const ownerOf = async (orgId: string): Promise<boolean> => {
      if (!owners.has(orgId)) owners.set(orgId, await this.access.isOwner(user, orgId));
      return owners.get(orgId) as boolean;
    };
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.snapLastName, id: r.id }),
      (r) => r,
    );
    const data: EntryDto[] = [];
    for (const r of page.data)
      data.push(
        toEntryDto(
          r,
          actions(r, r.application.status, await ownerOf(r.application.organization.id), r.category.status),
        ),
      );
    return { data, page: page.page };
  }

  /** Участия спортсмена во всех турнирах: карточка спортсмена, выбор турнира для документа. */
  async listForAthlete(user: AuthUser, athleteId: string): Promise<AthleteEntryDto[]> {
    await this.athletes.assertView(user, athleteId);
    const rows = await this.db.entry.findMany({
      where: { athleteId, competition: { deletedAt: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: {
        ...ENTRY_INCLUDE,
        competition: {
          select: { id: true, slug: true, name: true, status: true, startDate: true, timezone: true },
        },
      },
    });
    return rows.map((r) => ({
      ...toEntryDto(r, []),
      competition: {
        id: r.competition.id,
        slug: r.competition.slug,
        name: r.competition.name,
        status: r.competition.status,
        startDate: r.competition.startDate.toISOString().slice(0, 10),
        timezone: r.competition.timezone,
      },
    }));
  }

  private async dto(user: AuthUser, entryId: string): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    const role = await this.access.assertVisible(user, ctx);
    const row = await this.db.entry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        ...ENTRY_INCLUDE,
        category: { select: { id: true, code: true, nameRu: true, nameEn: true, status: true } },
      },
    });
    return toEntryDto(
      row,
      (await this.actionsFactory(user, ctx.competition))(
        row,
        ctx.application.status,
        role.owner,
        row.category.status,
      ),
    );
  }

  // ---------- Общие шаги команд ----------

  private async lockApplication(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM application WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.application.findUniqueOrThrow({ where: { id } });
  }

  private async lockEntry(tx: Tx, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM entry WHERE id = ${id}::uuid FOR UPDATE`;
    const entry = await tx.entry.findUniqueOrThrow({ where: { id } });
    if (version !== undefined && entry.version !== version) throw versionConflict(entry.version);
    return entry;
  }

  /** Инвариант «не больше N категорий на спортсмена» — по нескольким строкам: advisory lock (ARCHITECTURE.md, 10). */
  private async lockAthleteInCompetition(tx: Tx, competitionId: string, athleteId: string): Promise<void> {
    const key = `${competitionId}:${athleteId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private assertWindowOpen(competition: CompetitionBasics): void {
    const window = registrationWindow(competition, new Date());
    if (window === 'NOT_OPEN')
      throw new DomainError('REGISTRATION_NOT_OPEN', {
        registrationStartsAt: competition.registrationStartsAt.toISOString(),
      });
    if (window === 'CLOSED')
      throw new DomainError('REGISTRATION_CLOSED', {
        registrationEndsAt: competition.registrationEndsAt.toISOString(),
      });
  }

  private async snapshotData(tx: Tx, athlete: AthleteRegistrationInfo) {
    const club = athlete.memberships.find((m) => m.isPrimary) ?? athlete.memberships[0] ?? null;
    const snap = buildSnapshot({
      lastName: athlete.lastName,
      firstName: athlete.firstName,
      middleName: athlete.middleName,
      birthDate: athlete.birthDate,
      gender: athlete.gender,
      club: club ? { id: club.organizationId, name: club.name, regionId: club.regionId } : null,
      coachName: athlete.coachName,
      personRegionId: athlete.personRegionId,
      rankCode: athlete.rankCode,
    });
    const region = snap.snapRegionId
      ? await tx.region.findUnique({ where: { id: snap.snapRegionId }, select: { nameRu: true } })
      : null;
    return {
      ...snap,
      snapBirthDate: new Date(`${snap.snapBirthDate}T00:00:00.000Z`),
      snapRegionName: region?.nameRu ?? null,
    };
  }

  /** Заявка категории, лимит и совместимость — ошибки раздела 53 по причинам совместимости. */
  private eligibilityError(reasons: string[]): DomainError {
    if (reasons.includes('ALREADY_ENTERED')) return new DomainError('ATHLETE_ALREADY_ENTERED');
    if (reasons.includes('MAX_CATEGORIES_REACHED')) return new DomainError('MAX_CATEGORIES_EXCEEDED');
    if (reasons.includes('CATEGORY_CLOSED'))
      return new DomainError('REGISTRATION_CLOSED', { reason: 'category_closed' });
    return new DomainError('CATEGORY_INCOMPATIBLE', { reasons });
  }

  // ---------- Команды владельца ----------

  /**
   * Добавить спортсмена клуба в заявку (API.md, 5.3). Проверки: состав заявки открыт, окно регистрации, согласие
   * на обработку ПДн (ФЗ-152), категория турнира принимает заявки, совместимость и лимит категорий.
   */
  async add(user: AuthUser, applicationId: string, input: EntryCreate): Promise<EntryDto> {
    const ctx = await this.access.applicationContext(applicationId);
    await this.access.assertOwner(user, ctx);
    const athlete = await this.athletes.registrationInfo(input.athleteId);
    if (!athlete || !athlete.memberships.some((m) => m.organizationId === ctx.application.organizationId))
      throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    if (athlete.status !== 'ACTIVE')
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'athleteId', code: 'athlete_inactive' }],
      });
    const id = await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const app = await this.lockApplication(tx, applicationId);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const competition = await this.competitions.require(competitionId);
      this.assertWindowOpen(competition);
      const category = await this.categories.spec(input.categoryId, tx);
      if (!category || category.competitionId !== competitionId || !isActiveCategory(category.status))
        throw new DomainError('NOT_FOUND', { resource: 'category' });
      const consents = (await this.athleteExtensions.consentsStatusOf([athlete.personId])).get(
        athlete.personId,
      );
      if (consents?.PD_PROCESSING !== 'GIVEN')
        throw new DomainError('CONSENT_MISSING', { kinds: ['PD_PROCESSING'] });
      await this.lockAthleteInCompetition(tx, competitionId, athlete.athleteId);
      const evaluation = await this.eligibility.evaluate(tx, competition, athlete, {
        declaredWeightGrams: input.declaredWeightGrams ?? null,
      });
      const refused = evaluation.ineligible.find((i) => i.category.id === category.id);
      if (refused) throw this.eligibilityError(refused.reasons);
      const entryId = uuidv7();
      try {
        await tx.entry.create({
          data: {
            id: entryId,
            competitionId,
            applicationId,
            athleteId: athlete.athleteId,
            categoryId: category.id,
            declaredCategoryId: category.id,
            ...(await this.snapshotData(tx, athlete)),
            representationOrganizationId: app.representationOrganizationId,
            representationRegionId: app.representationRegionId,
            declaredWeightGrams: input.declaredWeightGrams ?? null,
            createdById: user.id,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainError('ATHLETE_ALREADY_ENTERED');
        throw e;
      }
      await tx.application.update({ where: { id: applicationId }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'entry.created',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: app.organizationId,
        after: { athleteId: athlete.athleteId, categoryId: category.id, status: 'PENDING' },
      });
      return entryId;
    });
    return this.dto(user, id);
  }

  /**
   * Убрать участника из заявки: из черновика ещё не рассмотренное участие удаляется, иначе участие снимается
   * (история решений сохраняется).
   */
  async remove(user: AuthUser, applicationId: string, entryId: string): Promise<void> {
    const ctx = await this.access.applicationContext(applicationId);
    await this.access.assertOwner(user, ctx);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, ctx.application.competitionId);
      const app = await this.lockApplication(tx, applicationId);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const entry = await this.lockEntry(tx, entryId);
      if (entry.applicationId !== applicationId) throw new DomainError('NOT_FOUND', { resource: 'entry' });
      if (entry.status === 'WITHDRAWN')
        throw new DomainError('INVALID_TRANSITION', { from: entry.status, to: 'WITHDRAWN', allowed: [] });
      const hardDelete = app.status === 'DRAFT' && entry.status === 'PENDING' && entry.decidedAt === null;
      if (hardDelete) await tx.entry.delete({ where: { id: entryId } });
      else
        await tx.entry.update({
          where: { id: entryId },
          data: {
            status: 'WITHDRAWN',
            withdrawnAt: new Date(),
            withdrawnById: user.id,
            withdrawReason: 'removed_from_application',
            version: { increment: 1 },
          },
        });
      await this.audit.record(tx, {
        action: hardDelete ? 'entry.deleted' : 'entry.withdrawn',
        entityType: 'Entry',
        entityId: entryId,
        competitionId: entry.competitionId,
        organizationId: app.organizationId,
        before: { status: entry.status },
        after: hardDelete ? null : { status: 'WITHDRAWN' },
      });
    });
  }

  /** Обновить снимок данных спортсмена — только явным действием владельца до решения по участию. */
  async refreshSnapshot(user: AuthUser, entryId: string, version: number): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    await this.access.assertOwner(user, ctx);
    const athlete = await this.athletes.registrationInfo(ctx.entry.athleteId);
    if (!athlete) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, ctx.application.competitionId);
      const app = await this.lockApplication(tx, ctx.application.id);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const entry = await this.lockEntry(tx, entryId, version);
      if (entry.status === 'APPROVED' || entry.status === 'WITHDRAWN') throw blocked('entry_decided');
      const competition = await this.competitions.require(entry.competitionId);
      const evaluation = await this.eligibility.evaluate(tx, competition, athlete, {
        excludeEntryId: entryId,
        ignoreCategoryStatus: true,
      });
      const refused = evaluation.ineligible.find((i) => i.category.id === entry.categoryId);
      if (refused) throw this.eligibilityError(refused.reasons);
      const snapshot = await this.snapshotData(tx, athlete);
      await tx.entry.update({ where: { id: entryId }, data: { ...snapshot, version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'entry.snapshot_refreshed',
        entityType: 'Entry',
        entityId: entryId,
        competitionId: entry.competitionId,
        organizationId: app.organizationId,
        before: { rankCode: entry.snapRankCode, clubId: entry.snapClubId },
        after: { rankCode: snapshot.snapRankCode, clubId: snapshot.snapClubId },
      });
    });
    return this.dto(user, entryId);
  }

  // ---------- Команды персонала ----------

  /**
   * Решение по участнику (API.md, 5.3): одобрить (`registration.approve`) или отклонить с причиной
   * (`registration.reject`). Первое решение по поданной заявке берёт её в работу (UNDER_REVIEW).
   */
  async decide(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryDecisionRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    const permission = req.decision === 'APPROVED' ? 'registration.approve' : 'registration.reject';
    const viaPlatform = await this.access.assertStaff(user, permission, ctx);
    const reason = req.reason?.trim() || null;
    if (req.decision === 'REJECTED' && !reason) throw new DomainError('REASON_REQUIRED');
    await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.competitions.require(competitionId);
      if (!DECISION_PHASE.includes(competition.status)) throw blocked('competition_status');
      const app = await this.lockApplication(tx, ctx.application.id);
      if (!isUnderStaffReview(app.status)) throw blocked('application_not_under_review');
      const entry = await this.lockEntry(tx, entryId, version);
      if (!decisionAllowed(entry.status, req.decision))
        throw new DomainError('INVALID_TRANSITION', {
          from: entry.status,
          to: req.decision,
          allowed: (['APPROVED', 'REJECTED'] as const).filter((d) => decisionAllowed(entry.status, d)),
        });
      if (req.decision === 'APPROVED') {
        const category = await this.categories.spec(entry.categoryId, tx);
        if (!category || !isActiveCategory(category.status)) throw blocked('category_inactive');
      }
      if (app.status === 'SUBMITTED') {
        await tx.application.update({
          where: { id: app.id },
          data: {
            status: 'UNDER_REVIEW',
            reviewedAt: new Date(),
            reviewedById: user.id,
            version: { increment: 1 },
          },
        });
        await this.audit.record(tx, {
          action: 'application.status_changed',
          entityType: 'Application',
          entityId: app.id,
          competitionId,
          organizationId: app.organizationId,
          before: { status: 'SUBMITTED' },
          after: { status: 'UNDER_REVIEW' },
        });
      }
      try {
        await tx.entry.update({
          where: { id: entryId },
          data: {
            status: req.decision,
            decidedAt: new Date(),
            decidedById: user.id,
            decisionReason: req.decision === 'REJECTED' ? reason : null,
            version: { increment: 1 },
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainError('ATHLETE_ALREADY_ENTERED');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'entry.decided',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: app.organizationId,
        before: { status: entry.status },
        after: { status: req.decision },
        reason,
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_decided',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: { entryId, decision: req.decision },
      });
    });
    return this.dto(user, entryId);
  }

  /**
   * Снятие участника: владелец заявки — до окончания регистрации, персонал — с `entry.withdraw`.
   * Снятие после жеребьёвки (поражения неявкой в незавершённых схватках) подключат Phase 5–7.
   */
  async withdraw(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryWithdrawRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    const staff = await this.access.canStaff(user, 'entry.withdraw', ctx.competitionScope);
    if (!staff) {
      const owner = await this.access.isOwner(user, ctx.application.organizationId);
      if (!owner) {
        await this.access.assertVisible(user, ctx);
        throw new DomainError('FORBIDDEN', { permission: 'entry.withdraw' });
      }
      if (registrationWindow(ctx.competition, new Date()) !== 'OPEN')
        throw new DomainError('REGISTRATION_CLOSED', {
          registrationEndsAt: ctx.competition.registrationEndsAt.toISOString(),
        });
    }
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, ctx.application.competitionId);
      await this.lockApplication(tx, ctx.application.id);
      const entry = await this.lockEntry(tx, entryId, version);
      if (!isActiveEntry(entry.status))
        throw new DomainError('INVALID_TRANSITION', { from: entry.status, to: 'WITHDRAWN', allowed: [] });
      await tx.entry.update({
        where: { id: entryId },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: new Date(),
          withdrawnById: user.id,
          withdrawReason: req.reason,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'entry.withdrawn',
        entityType: 'Entry',
        entityId: entryId,
        competitionId: entry.competitionId,
        organizationId: ctx.application.organizationId,
        before: { status: entry.status },
        after: { status: 'WITHDRAWN' },
        reason: req.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_withdrawn',
        aggregate: { type: 'Entry', id: entryId },
        competitionId: entry.competitionId,
        payload: { entryId },
      });
    });
    return this.dto(user, entryId);
  }

  /**
   * Перевод в другую категорию (`entry.transfer`): обе категории — до жеребьёвки, совместимость — по снимку
   * участия. Заявленная категория сохраняется.
   */
  async transfer(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryTransferRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.competitions.require(competitionId);
      if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(competition.status))
        throw blocked('competition_closed');
      const entry = await this.lockEntry(tx, entryId, version);
      if (!isActiveEntry(entry.status))
        throw new DomainError('INVALID_TRANSITION', { from: entry.status, to: 'TRANSFERRED', allowed: [] });
      const [from, to] = await Promise.all([
        this.categories.spec(entry.categoryId, tx),
        this.categories.spec(req.toCategoryId, tx),
      ]);
      if (!to || to.competitionId !== competitionId)
        throw new DomainError('NOT_FOUND', { resource: 'category' });
      if (to.id === entry.categoryId)
        throw new DomainError('CATEGORY_TRANSFER_NOT_ALLOWED', { reason: 'same_category' });
      if (!MERGEABLE.includes(to.status) || !from || !MERGEABLE.includes(from.status))
        throw new DomainError('CATEGORY_TRANSFER_NOT_ALLOWED', { reason: 'category_drawn' });
      await this.lockAthleteInCompetition(tx, competitionId, entry.athleteId);
      const evaluation = await this.eligibility.evaluate(
        tx,
        competition,
        {
          athleteId: entry.athleteId,
          personId: '',
          status: 'ACTIVE',
          lastName: entry.snapLastName,
          firstName: entry.snapFirstName,
          middleName: entry.snapMiddleName,
          birthDate: entry.snapBirthDate.toISOString().slice(0, 10),
          gender: entry.snapGender,
          personRegionId: entry.snapRegionId,
          memberships: [],
          coachName: entry.snapCoachName,
          rankCode: entry.snapRankCode,
        },
        { excludeEntryId: entryId, ignoreCategoryStatus: true },
      );
      const refused = evaluation.ineligible.find((i) => i.category.id === to.id);
      if (refused) throw this.eligibilityError(refused.reasons.filter((r) => r !== 'MAX_CATEGORIES_REACHED'));
      try {
        await tx.entry.update({
          where: { id: entryId },
          data: { categoryId: to.id, version: { increment: 1 } },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainError('ATHLETE_ALREADY_ENTERED');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'entry.transferred',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: ctx.application.organizationId,
        before: { categoryId: entry.categoryId },
        after: { categoryId: to.id },
        reason: req.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_transferred',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: { entryId, fromCategoryId: entry.categoryId, toCategoryId: to.id },
      });
    });
    return this.dto(user, entryId);
  }

  /**
   * Эффекты перехода заявки на участия: отклонение заявки отклоняет нерассмотренных; отзыв заявки снимает
   * действующих; повторная подача возвращает отклонённых на рассмотрение.
   */
  async onApplicationTransition(
    tx: Tx,
    applicationId: string,
    from: ApplicationStatus,
    to: ApplicationStatus,
    comment: string | null,
  ): Promise<void> {
    const userId = RequestContextStore.current().user?.id ?? null;
    const now = new Date();
    if (to === 'REJECTED')
      await tx.entry.updateMany({
        where: { applicationId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedAt: now,
          decidedById: userId,
          decisionReason: comment ?? 'application_rejected',
          version: { increment: 1 },
        },
      });
    if (to === 'CANCELLED')
      await tx.entry.updateMany({
        where: { applicationId, status: { in: [...ACTIVE_ENTRY_STATUSES] } },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: now,
          withdrawnById: userId,
          withdrawReason: 'application_cancelled',
          version: { increment: 1 },
        },
      });
    if (from === 'WAITING_DOCUMENTS' && to === 'SUBMITTED') {
      // Отклонённый участник возвращается на рассмотрение, если спортсмена не заявили в ту же категорию заново.
      const rejected = await tx.entry.findMany({
        where: { applicationId, status: 'REJECTED' },
        select: { id: true, categoryId: true, athleteId: true },
      });
      for (const r of rejected) {
        const duplicate = await tx.entry.findFirst({
          where: {
            categoryId: r.categoryId,
            athleteId: r.athleteId,
            status: { in: [...ACTIVE_ENTRY_STATUSES] },
          },
          select: { id: true },
        });
        if (duplicate) continue;
        await tx.entry.update({
          where: { id: r.id },
          data: {
            status: 'PENDING',
            decidedAt: null,
            decidedById: null,
            decisionReason: null,
            version: { increment: 1 },
          },
        });
      }
    }
  }
}
