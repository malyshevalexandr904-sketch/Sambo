// Участия (API.md, 5.3): чтение, добавление спортсмена в заявку со снимком (ADR-10), удаление из черновика,
// обновление снимка и последствия переходов заявки. Решения персонала — EntryDecisionsService.
// Инварианты раздела 53 — в сервисе и в БД (entry_active_uq).
import { Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  type AthleteEntryDto,
  type EntriesQuery,
  type EntryCreate,
  type EntryDto,
  type Page,
  type PermissionCode,
} from '@sde/contracts';
import { type Prisma, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService, AthleteExtensions } from '../../athletes';
import { AuditService } from '../../audit';
import { CompetitionCategoriesService, isActiveCategory, MERGEABLE } from '../../categories';
import { type CompetitionBasics, CompetitionScopeService, registrationWindow } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { isEditableByOwner, isUnderStaffReview } from '../domain/application-machine';
import { decisionAllowed, isActiveEntry } from '../domain/entry-rules';
import { EligibilityService } from './eligibility.service';
import {
  assertWindowOpen,
  blocked,
  DECISION_PHASE,
  eligibilityError,
  isUniqueViolation,
  lockApplication,
  lockAthleteInCompetition,
  lockEntry,
  snapshotData,
} from './entry-commands';
import { type ApplicationContext, RegistrationAccessService } from './registration-access.service';
import { ENTRY_INCLUDE, type EntryRow, toEntryDto } from './registration-mapper';

const STAFF_ACTIONS: readonly PermissionCode[] = [
  'registration.view',
  'registration.approve',
  'registration.reject',
  'entry.withdraw',
  'entry.transfer',
];

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

  /** Участие с действиями текущего пользователя (ответ команд). */
  async get(user: AuthUser, entryId: string): Promise<EntryDto> {
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

  /** Действующий спортсмен клуба заявки; чужой спортсмен — `404`. */
  private async clubAthlete(athleteId: string, organizationId: string) {
    const athlete = await this.athletes.registrationInfo(athleteId);
    if (!athlete || !athlete.memberships.some((m) => m.organizationId === organizationId))
      throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    if (athlete.status !== 'ACTIVE')
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'athleteId', code: 'athlete_inactive' }],
      });
    return athlete;
  }

  /** Действующее согласие на обработку ПДн (ФЗ-152) — условие любой заявки спортсмена. */
  private async assertConsent(personId: string): Promise<void> {
    const consents = (await this.athleteExtensions.consentsStatusOf([personId])).get(personId);
    if (consents?.PD_PROCESSING !== 'GIVEN')
      throw new DomainError('CONSENT_MISSING', { kinds: ['PD_PROCESSING'] });
  }

  // ---------- Команды владельца ----------

  /**
   * Добавить спортсмена клуба в заявку (API.md, 5.3). Проверки: состав заявки открыт, окно регистрации, согласие
   * на обработку ПДн (ФЗ-152), категория турнира принимает заявки, совместимость и лимит категорий.
   */
  async add(user: AuthUser, applicationId: string, input: EntryCreate): Promise<EntryDto> {
    const ctx = await this.access.applicationContext(applicationId);
    await this.access.assertOwner(user, ctx);
    const athlete = await this.clubAthlete(input.athleteId, ctx.application.organizationId);
    const id = await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const app = await lockApplication(tx, applicationId);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const competition = await this.competitions.require(competitionId);
      assertWindowOpen(competition);
      const category = await this.categories.spec(input.categoryId, tx);
      if (!category || category.competitionId !== competitionId || !isActiveCategory(category.status))
        throw new DomainError('NOT_FOUND', { resource: 'category' });
      await this.assertConsent(athlete.personId);
      await lockAthleteInCompetition(tx, competitionId, athlete.athleteId);
      const evaluation = await this.eligibility.evaluate(tx, competition, athlete, {
        declaredWeightGrams: input.declaredWeightGrams ?? null,
      });
      const refused = evaluation.ineligible.find((i) => i.category.id === category.id);
      if (refused) throw eligibilityError(refused.reasons);
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
            ...(await snapshotData(tx, athlete)),
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
    return this.get(user, id);
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
      const app = await lockApplication(tx, applicationId);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const entry = await lockEntry(tx, entryId);
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
      const app = await lockApplication(tx, ctx.application.id);
      if (!isEditableByOwner(app.status)) throw blocked('application_not_editable');
      const entry = await lockEntry(tx, entryId, version);
      if (entry.status === 'APPROVED' || entry.status === 'WITHDRAWN') throw blocked('entry_decided');
      const competition = await this.competitions.require(entry.competitionId);
      const evaluation = await this.eligibility.evaluate(tx, competition, athlete, {
        excludeEntryId: entryId,
        ignoreCategoryStatus: true,
      });
      const refused = evaluation.ineligible.find((i) => i.category.id === entry.categoryId);
      if (refused) throw eligibilityError(refused.reasons);
      const snapshot = await snapshotData(tx, athlete);
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
    return this.get(user, entryId);
  }
}
