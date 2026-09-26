// Категории турнира (API.md, 5.2; ARCHITECTURE.md, 16.2): генерация из шаблона, ручная правка, переходы,
// объединение (D-03). Снимок границ хранится в категории: правка шаблона не меняет турнир.
import { Injectable } from '@nestjs/common';
import type {
  CategoryGenerateRequest,
  CategoryInput,
  CategoryMergeRequest,
  CategoryPatch,
  CategoriesQuery,
  CategoryTransitionRequest,
  CompetitionCategoryDto,
  CompetitionStatus,
  Page,
  PermissionCode,
} from '@sde/contracts';
import { type CompetitionCategory, type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { AuditService } from '../../audit';
import { type CompetitionBasics, CompetitionScopeService } from '../../competitions';
import { OrganizationScopeService } from '../../organizations';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import {
  findCategoryTransition,
  initialCategoryStatus,
  isActiveCategory,
  manualTransitionsFrom,
  MERGEABLE,
} from '../domain/category-machine';
import { generateCategories, type TemplateItem } from '../domain/category-generation';
import { type MergeBounds, mergedBounds, mergeIssues, renameForWeight } from '../domain/category-merge';
import { CategoryExtensions, type EntryStats } from './category-extensions';
import {
  boundsOf,
  type CategoryRow,
  type CompetitionCategorySpec,
  toCategoryDto,
  toSpec,
} from './category-mapper';

type BoundsData = Pick<
  Prisma.CompetitionCategoryUncheckedCreateInput,
  | 'agePolicy'
  | 'ageFrom'
  | 'ageTo'
  | 'birthYearFrom'
  | 'birthYearTo'
  | 'ageReferenceDate'
  | 'weightKind'
  | 'weightLowerGrams'
  | 'weightUpperGrams'
>;

const REGISTRATION_PHASE: readonly CompetitionStatus[] = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
];
const CLOSED_COMPETITION: readonly CompetitionStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];
const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

const ACTION_CANDIDATES: readonly PermissionCode[] = [
  'competition_category.manage',
  'category.merge',
  'competition.transition',
];

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

@Injectable()
export class CompetitionCategoriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly extensions: CategoryExtensions,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Доступ ----------

  /** Опубликованный турнир и его категории видит любой вошедший; черновик — только с `competition.view`. */
  async assertReadable(
    user: AuthUser,
    competitionId: string,
  ): Promise<{ competition: CompetitionBasics; scope: ResourceScope }> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    if (competition.status === 'DRAFT') await this.policy.assert(user, 'competition.view', scope);
    return { competition, scope };
  }

  private async actionsFor(
    user: AuthUser,
    scope: ResourceScope,
    competition: CompetitionBasics,
  ): Promise<(row: CategoryRow, stats: EntryStats) => string[]> {
    const perms = new Set(await this.policy.allowedActions(user, scope, ACTION_CANDIDATES));
    return (row, stats) => {
      const actions: string[] = [];
      const open = !CLOSED_COMPETITION.includes(competition.status) && isActiveCategory(row.status);
      if (perms.has('competition_category.manage') && open) {
        actions.push('category.update');
        if (stats.total === 0 && REGISTRATION_PHASE.includes(competition.status))
          actions.push('category.delete');
      }
      if (perms.has('category.merge') && MERGEABLE.includes(row.status)) actions.push('category.merge');
      if (perms.has('competition.transition'))
        for (const to of manualTransitionsFrom(row.status)) {
          const def = findCategoryTransition(row.status, to);
          if (def?.competition.includes(competition.status)) actions.push(`transition:${to}`);
        }
      return actions;
    };
  }

  // ---------- Чтение ----------

  async list(
    user: AuthUser,
    competitionId: string,
    q: CategoriesQuery,
  ): Promise<Page<CompetitionCategoryDto>> {
    const { competition, scope } = await this.assertReadable(user, competitionId);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.competitionCategory.findMany({
      where: {
        competitionId,
        gender: q.gender,
        ageGroupId: q.ageGroupId,
        status: q.status,
        ...(cursor
          ? {
              OR: [
                { sortOrder: { gt: Number(cursor.k) } },
                { sortOrder: Number(cursor.k), id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const stats = await this.extensions.stats(
      null,
      rows.map((r) => r.id),
    );
    const actions = await this.actionsFor(user, scope, competition);
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: String(r.sortOrder), id: r.id }),
      (r) => {
        const s = stats.get(r.id) ?? { active: 0, approved: 0, total: 0 };
        return toCategoryDto(r, s, actions(r, s));
      },
    );
  }

  async get(user: AuthUser, competitionId: string, categoryId: string): Promise<CompetitionCategoryDto> {
    const { competition, scope } = await this.assertReadable(user, competitionId);
    const row = await this.db.competitionCategory.findFirst({ where: { id: categoryId, competitionId } });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'category' });
    const s = await this.extensions.statsOf(null, row.id);
    return toCategoryDto(row, s, (await this.actionsFor(user, scope, competition))(row, s));
  }

  // ---------- Для модуля заявок ----------

  /** Категории турнира для расчёта совместимости (все, кроме объединённых и отменённых). */
  async specs(competitionId: string, tx?: Tx): Promise<CompetitionCategorySpec[]> {
    const rows = await (tx ?? this.db).competitionCategory.findMany({
      where: { competitionId, status: { notIn: ['MERGED', 'CANCELLED'] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSpec);
  }

  async spec(categoryId: string, tx?: Tx): Promise<CompetitionCategorySpec | null> {
    const row = await (tx ?? this.db).competitionCategory.findUnique({ where: { id: categoryId } });
    return row ? toSpec(row) : null;
  }

  // ---------- Общие проверки команд ----------

  /** Право записи и блокировка турнира на чтение: переход турнира (FOR UPDATE) ждёт команд над категориями. */
  private async lockCompetition(tx: Tx, competitionId: string): Promise<CompetitionStatus> {
    await this.leases.assertWritable(tx, competitionId);
    const rows = await tx.$queryRaw<{ status: CompetitionStatus }[]>`
      SELECT status FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR SHARE`;
    if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return rows[0].status;
  }

  private async lockCategory(
    tx: Tx,
    competitionId: string,
    categoryId: string,
    version?: number,
  ): Promise<CategoryRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM competition_category WHERE id = ${categoryId}::uuid AND competition_id = ${competitionId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'category' });
    const row = await tx.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } });
    if (version !== undefined && row.version !== version) throw versionConflict(row.version);
    return row;
  }

  /** Возрастная группа — из справочника платформы или организатора (его предков) той же дисциплины. */
  private async assertAgeGroup(tx: Tx, ageGroupId: string, competition: CompetitionBasics): Promise<void> {
    const lineage = (await this.orgScopes.scopeOf(competition.organizerOrganizationId)).ancestorIds;
    const group = await tx.ageGroup.findUnique({ where: { id: ageGroupId } });
    if (
      !group ||
      group.disciplineCode !== competition.disciplineCode ||
      (group.ownerOrganizationId !== null && !lineage.includes(group.ownerOrganizationId))
    )
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'ageGroupId', code: 'not_found' }] });
  }

  private boundsData(input: Pick<CategoryInput, 'age' | 'weight'>): BoundsData {
    return {
      agePolicy: input.age.policy,
      ageFrom: input.age.ageFrom ?? null,
      ageTo: input.age.ageTo ?? null,
      birthYearFrom: input.age.birthYearFrom ?? null,
      birthYearTo: input.age.birthYearTo ?? null,
      ageReferenceDate: input.age.referenceDate ? toDate(input.age.referenceDate) : null,
      weightKind: input.weight.kind,
      weightLowerGrams: input.weight.lowerGrams ?? null,
      weightUpperGrams: input.weight.kind === 'ABOVE' ? null : (input.weight.upperGrams ?? null),
    };
  }

  // ---------- Команды ----------

  async create(user: AuthUser, competitionId: string, input: CategoryInput): Promise<CompetitionCategoryDto> {
    const competition = await this.competitions.require(competitionId);
    const id = await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      if (!REGISTRATION_PHASE.includes(status)) throw blocked('competition_status');
      if (input.ageGroupId) await this.assertAgeGroup(tx, input.ageGroupId, competition);
      const created = await tx.competitionCategory.create({
        data: {
          id: uuidv7(),
          competitionId,
          code: input.code,
          nameRu: input.name.ru,
          nameEn: input.name.en,
          gender: input.gender,
          ageGroupId: input.ageGroupId ?? null,
          ...this.boundsData(input),
          formatOverride: input.formatOverride ?? null,
          status: initialCategoryStatus(status),
          sortOrder: input.sortOrder ?? (await this.nextSortOrder(tx, competitionId)),
        },
      });
      await this.audit.record(tx, {
        action: 'category.created',
        entityType: 'CompetitionCategory',
        entityId: created.id,
        competitionId,
        after: { code: created.code, gender: created.gender, ...boundsOf(created) },
      });
      return created.id;
    });
    return this.get(user, competitionId, id);
  }

  private async nextSortOrder(tx: Tx, competitionId: string): Promise<number> {
    const last = await tx.competitionCategory.aggregate({
      where: { competitionId },
      _max: { sortOrder: true },
    });
    return (last._max.sortOrder ?? 0) + 10;
  }

  /**
   * Границы (возраст, вес) меняются только до жеребьёвки и пока нет одобренных участий: иначе одобренный
   * участник оказался бы вне своей категории. Название, код и порядок меняются до завершения турнира.
   */
  async update(
    user: AuthUser,
    competitionId: string,
    categoryId: string,
    version: number,
    patch: CategoryPatch,
  ): Promise<CompetitionCategoryDto> {
    await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      if (CLOSED_COMPETITION.includes(status)) throw blocked('competition_closed');
      const row = await this.lockCategory(tx, competitionId, categoryId, version);
      if (!isActiveCategory(row.status)) throw blocked('category_inactive');
      const boundsChanged = patch.age !== undefined || patch.weight !== undefined;
      if (boundsChanged) {
        if (!MERGEABLE.includes(row.status)) throw blocked('category_drawn');
        if ((await this.extensions.statsOf(tx, categoryId)).approved > 0)
          throw blocked('category_has_approved_entries');
      }
      const current = boundsOf(row);
      const data: Prisma.CompetitionCategoryUncheckedUpdateInput = {
        code: patch.code,
        nameRu: patch.name?.ru,
        nameEn: patch.name?.en,
        formatOverride: patch.formatOverride,
        sortOrder: patch.sortOrder,
        ...(boundsChanged
          ? this.boundsData({ age: patch.age ?? current.age, weight: patch.weight ?? current.weight })
          : {}),
        version: { increment: 1 },
      };
      await tx.competitionCategory.update({ where: { id: categoryId }, data });
      const after = await tx.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } });
      await this.audit.record(tx, {
        action: 'category.updated',
        entityType: 'CompetitionCategory',
        entityId: categoryId,
        competitionId,
        before: { code: row.code, nameRu: row.nameRu, ...current },
        after: { code: after.code, nameRu: after.nameRu, ...boundsOf(after) },
      });
    });
    return this.get(user, competitionId, categoryId);
  }

  /** Ошибочно созданная категория удаляется, пока в неё никого не заявляли; иначе — отмена (CANCELLED). */
  async remove(competitionId: string, categoryId: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      if (!REGISTRATION_PHASE.includes(status)) throw blocked('competition_status');
      const row = await this.lockCategory(tx, competitionId, categoryId);
      if ((await this.extensions.statsOf(tx, categoryId)).total > 0) throw blocked('category_has_entries');
      if (
        await tx.competitionCategory.findFirst({ where: { mergedIntoId: categoryId }, select: { id: true } })
      )
        throw blocked('category_has_merged_sources');
      await tx.competitionCategory.delete({ where: { id: categoryId } });
      await this.audit.record(tx, {
        action: 'category.deleted',
        entityType: 'CompetitionCategory',
        entityId: categoryId,
        competitionId,
        before: { code: row.code, status: row.status },
      });
    });
  }

  /**
   * Генерация из шаблона (API.md, 5.2). `replaceExisting` заменяет все категории, пока в турнире нет участий;
   * иначе добавляются категории с новыми кодами, существующие не меняются.
   */
  async generate(
    user: AuthUser,
    competitionId: string,
    req: CategoryGenerateRequest,
  ): Promise<CompetitionCategoryDto[]> {
    const competition = await this.competitions.require(competitionId);
    const createdIds = await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      if (!REGISTRATION_PHASE.includes(status)) throw blocked('competition_status');
      const items = await this.templateItems(tx, req.templateId, competition);
      const existing = await tx.competitionCategory.findMany({ where: { competitionId } });
      if (req.replaceExisting && existing.length > 0) {
        const stats = await this.extensions.stats(
          tx,
          existing.map((c) => c.id),
        );
        if ([...stats.values()].some((s) => s.total > 0)) throw blocked('categories_have_entries');
        await tx.competitionCategory.updateMany({
          where: { competitionId, mergedIntoId: { not: null } },
          data: { mergedIntoId: null, status: 'CANCELLED' },
        });
        await tx.competitionCategory.deleteMany({ where: { competitionId } });
      }
      const taken = new Set(req.replaceExisting ? [] : existing.map((c) => c.code));
      const base = req.replaceExisting ? 0 : Math.max(0, ...existing.map((c) => c.sortOrder));
      const generated = generateCategories(items, competition.startDate).filter((g) => !taken.has(g.code));
      const initial = initialCategoryStatus(status);
      const ids: string[] = [];
      for (const g of generated) {
        const id = uuidv7();
        ids.push(id);
        await tx.competitionCategory.create({
          data: {
            id,
            competitionId,
            code: g.code,
            nameRu: g.nameRu,
            nameEn: g.nameEn,
            gender: g.gender,
            ageGroupId: g.ageGroupId,
            agePolicy: g.agePolicy,
            ageFrom: g.ageFrom,
            ageTo: g.ageTo,
            birthYearFrom: g.birthYearFrom,
            birthYearTo: g.birthYearTo,
            weightKind: g.weight.kind,
            weightLowerGrams: g.weight.lowerGrams,
            weightUpperGrams: g.weight.upperGrams,
            status: initial,
            sortOrder: base + g.sortOrder,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'category.generated',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        after: {
          templateId: req.templateId,
          replaceExisting: req.replaceExisting,
          created: generated.map((g) => g.code),
          removed: req.replaceExisting ? existing.map((c) => c.code) : [],
        },
      });
      return ids;
    });
    const page = await this.list(user, competitionId, { limit: 500 });
    return page.data.filter((c) => createdIds.includes(c.id));
  }

  /** Шаблон платформы или организатора (его предков) той же дисциплины, что и турнир. */
  private async templateItems(
    tx: Tx,
    templateId: string,
    competition: CompetitionBasics,
  ): Promise<TemplateItem[]> {
    const lineage = (await this.orgScopes.scopeOf(competition.organizerOrganizationId)).ancestorIds;
    const template = await tx.categoryTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      include: { items: { include: { ageGroup: true, weightCategory: true } } },
    });
    if (
      !template ||
      template.disciplineCode !== competition.disciplineCode ||
      (template.ownerOrganizationId !== null && !lineage.includes(template.ownerOrganizationId))
    )
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'templateId', code: 'not_found' }] });
    return template.items.map((i) => ({
      ageGroup: {
        id: i.ageGroup.id,
        code: i.ageGroup.code,
        nameRu: i.ageGroup.nameRu,
        nameEn: i.ageGroup.nameEn,
        policy: i.ageGroup.policy,
        ageFrom: i.ageGroup.ageFrom,
        ageTo: i.ageGroup.ageTo,
      },
      gender: i.gender,
      weight: { kind: i.weightCategory.kind, limitGrams: i.weightCategory.limitGrams },
    }));
  }

  /** Переход категории вручную (ARCHITECTURE.md, 16.2): право `competition.transition`, условия — по статусу турнира. */
  async transition(
    user: AuthUser,
    competitionId: string,
    categoryId: string,
    version: number,
    req: CategoryTransitionRequest,
  ): Promise<CompetitionCategoryDto> {
    await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      const row = await this.lockCategory(tx, competitionId, categoryId, version);
      const def = findCategoryTransition(row.status, req.to);
      if (!def?.manual)
        throw new DomainError('INVALID_TRANSITION', {
          from: row.status,
          to: req.to,
          allowed: manualTransitionsFrom(row.status),
        });
      if (!def.competition.includes(status)) throw blocked('competition_status');
      if (def.reasonRequired && !req.reason) throw new DomainError('REASON_REQUIRED');
      const failed: string[] = [];
      if (row.status === 'CLOSED' && req.to === 'READY_FOR_DRAW') {
        const weighIn = await tx.competitionRequirement.findFirst({
          where: { competitionId, kind: 'WEIGH_IN', OR: [{ categoryId: null }, { categoryId }] },
          select: { id: true },
        });
        if (weighIn) failed.push('weigh_in_required');
      }
      failed.push(
        ...(await this.extensions.check({ tx, competitionId, categoryId, from: row.status, to: req.to })),
      );
      if (failed.length > 0) throw blocked(...failed);
      await tx.competitionCategory.update({
        where: { id: categoryId },
        data: { status: req.to, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'category.status_changed',
        entityType: 'CompetitionCategory',
        entityId: categoryId,
        competitionId,
        before: { status: row.status },
        after: { status: req.to },
        reason: req.reason ?? null,
      });
      await this.outbox.enqueue(tx, {
        type: 'category.status_changed',
        aggregate: { type: 'CompetitionCategory', id: categoryId },
        competitionId,
        payload: { categoryId, from: row.status, to: req.to },
      });
    });
    return this.get(user, competitionId, categoryId);
  }

  /**
   * Объединение категорий (D-03): до жеребьёвки, одного пола и способа расчёта возраста. Действующие участия
   * переносятся в целевую категорию, заявленная категория участия сохраняется; границы целевой категории
   * расширяются до объединения границ, исходные категории получают статус MERGED.
   */
  async merge(
    user: AuthUser,
    competitionId: string,
    req: CategoryMergeRequest,
  ): Promise<CompetitionCategoryDto> {
    const handler = this.extensions.merge();
    await this.db.tx(async (tx) => {
      const status = await this.lockCompetition(tx, competitionId);
      if (CLOSED_COMPETITION.includes(status)) throw blocked('competition_closed');
      const ids = [req.targetCategoryId, ...req.sourceCategoryIds].sort();
      const rows = new Map<string, CompetitionCategory>();
      for (const id of ids) rows.set(id, await this.lockCategory(tx, competitionId, id));
      const target = rows.get(req.targetCategoryId) as CompetitionCategory;
      const sources = req.sourceCategoryIds.map((id) => rows.get(id) as CompetitionCategory);
      if ([target, ...sources].some((c) => !MERGEABLE.includes(c.status)))
        throw new DomainError('CATEGORY_NOT_READY_FOR_DRAW', {
          categoryIds: [target, ...sources].filter((c) => !MERGEABLE.includes(c.status)).map((c) => c.id),
        });
      const toBounds = (c: CompetitionCategory): MergeBounds => ({ gender: c.gender, ...flat(c) });
      const issues = mergeIssues(toBounds(target), sources.map(toBounds));
      if (issues.length > 0) throw blocked(...issues);
      const conflicts = handler ? await handler.conflicts(tx, ids) : [];
      if (conflicts.length > 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
          failed: ['athlete_in_several_categories'],
          athleteIds: conflicts,
        });
      const moved = handler ? await handler.move(tx, req.sourceCategoryIds, target.id) : 0;
      await tx.competitionCategory.updateMany({
        where: { id: { in: req.sourceCategoryIds } },
        data: { status: 'MERGED', mergedIntoId: target.id, version: { increment: 1 } },
      });
      const merged = mergedBounds(toBounds(target), sources.map(toBounds));
      const before = flat(target);
      await tx.competitionCategory.update({
        where: { id: target.id },
        data: {
          ageFrom: merged.ageFrom,
          ageTo: merged.ageTo,
          birthYearFrom: merged.birthYearFrom,
          birthYearTo: merged.birthYearTo,
          weightKind: merged.weight.kind,
          weightLowerGrams: merged.weight.lowerGrams,
          weightUpperGrams: merged.weight.upperGrams,
          nameRu: renameForWeight(target.nameRu, before.weight, merged.weight, 'ru'),
          nameEn: renameForWeight(target.nameEn, before.weight, merged.weight, 'en'),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'category.merged',
        entityType: 'CompetitionCategory',
        entityId: target.id,
        competitionId,
        before: { target: target.code, sources: sources.map((s) => s.code), ...before },
        after: {
          movedEntries: moved,
          ageFrom: merged.ageFrom,
          ageTo: merged.ageTo,
          birthYearFrom: merged.birthYearFrom,
          birthYearTo: merged.birthYearTo,
          weight: merged.weight,
        },
        reason: req.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'category.merged',
        aggregate: { type: 'CompetitionCategory', id: target.id },
        competitionId,
        payload: { targetCategoryId: target.id, sourceCategoryIds: req.sourceCategoryIds },
      });
    });
    return this.get(user, competitionId, req.targetCategoryId);
  }
}

function flat(c: CompetitionCategory): Omit<MergeBounds, 'gender'> {
  const b = boundsOf(c);
  return {
    agePolicy: b.age.policy,
    ageFrom: b.age.ageFrom,
    ageTo: b.age.ageTo,
    birthYearFrom: b.age.birthYearFrom,
    birthYearTo: b.age.birthYearTo,
    weight: b.weight,
  };
}
