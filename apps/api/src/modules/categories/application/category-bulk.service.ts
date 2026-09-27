// Массовые команды над категориями турнира (API.md, 5.2): генерация из шаблона и объединение (D-03).
import { Injectable } from '@nestjs/common';
import type {
  CategoryGenerateRequest,
  CategoryMergeRequest,
  CompetitionCategoryDto,
  CompetitionStatus,
} from '@sde/contracts';
import { type CompetitionCategory, type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { type CompetitionBasics, CompetitionScopeService } from '../../competitions';
import { OrganizationScopeService } from '../../organizations';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { initialCategoryStatus, MERGEABLE } from '../domain/category-machine';
import { type GeneratedCategory, generateCategories, type TemplateItem } from '../domain/category-generation';
import { type MergeBounds, mergedBounds, mergeIssues, renameForWeight } from '../domain/category-merge';
import { CategoryExtensions } from './category-extensions';
import { blocked, lockCategory, lockCompetitionShared } from './category-locks';
import { boundsOf } from './category-mapper';
import { CompetitionCategoriesService } from './competition-categories.service';

const REGISTRATION_PHASE: readonly CompetitionStatus[] = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
];
const CLOSED_COMPETITION: readonly CompetitionStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];

@Injectable()
export class CategoryBulkService {
  constructor(
    private readonly db: PrismaService,
    private readonly categories: CompetitionCategoriesService,
    private readonly competitions: CompetitionScopeService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly extensions: CategoryExtensions,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async lockCompetition(tx: Tx, competitionId: string): Promise<CompetitionStatus> {
    await this.leases.assertWritable(tx, competitionId);
    return lockCompetitionShared(tx, competitionId);
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
        await deleteAllCategories(tx, competitionId);
      }
      const taken = new Set(req.replaceExisting ? [] : existing.map((c) => c.code));
      const base = req.replaceExisting ? 0 : Math.max(0, ...existing.map((c) => c.sortOrder));
      const generated = generateCategories(items, competition.startDate).filter((g) => !taken.has(g.code));
      const initial = initialCategoryStatus(status);
      const ids: string[] = [];
      for (const g of generated) {
        const id = uuidv7();
        ids.push(id);
        await tx.competitionCategory.create({ data: generatedData(g, id, competitionId, initial, base) });
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
    const page = await this.categories.list(user, competitionId, { limit: 500 });
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
      for (const id of ids) rows.set(id, await lockCategory(tx, competitionId, id));
      const target = rows.get(req.targetCategoryId) as CompetitionCategory;
      const sources = req.sourceCategoryIds.map((id) => rows.get(id) as CompetitionCategory);
      const drawn = [target, ...sources].filter((c) => !MERGEABLE.includes(c.status)).map((c) => c.id);
      if (drawn.length > 0) throw new DomainError('CATEGORY_NOT_READY_FOR_DRAW', { categoryIds: drawn });
      const toBounds = (c: CompetitionCategory): MergeBounds => ({ gender: c.gender, ...flat(c) });
      const issues = mergeIssues(toBounds(target), sources.map(toBounds));
      if (issues.length > 0) throw blocked(...issues);
      const conflicts = handler ? await handler.conflicts(tx, ids) : [];
      if (conflicts.length > 0) throw blockedBy('athlete_in_several_categories', { athleteIds: conflicts });
      const moved = handler ? await handler.move(tx, req.sourceCategoryIds, target.id) : 0;
      await tx.competitionCategory.updateMany({
        where: { id: { in: req.sourceCategoryIds } },
        data: { status: 'MERGED', mergedIntoId: target.id, version: { increment: 1 } },
      });
      const merged = mergedBounds(toBounds(target), sources.map(toBounds));
      const before = flat(target);
      await tx.competitionCategory.update({
        where: { id: target.id },
        data: mergedTargetData(target, before, merged),
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
    return this.categories.get(user, competitionId, req.targetCategoryId);
  }
}

const blockedBy = (code: string, details: Record<string, unknown>): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: [code], ...details });

/** Строка категории из сгенерированной: снимок границ на год начала турнира. */
function generatedData(
  g: GeneratedCategory,
  id: string,
  competitionId: string,
  status: CompetitionCategory['status'],
  sortBase: number,
): Prisma.CompetitionCategoryUncheckedCreateInput {
  return {
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
    status,
    sortOrder: sortBase + g.sortOrder,
  };
}

/** Удалить все категории турнира (замена при генерации): сначала разорвать ссылки объединения (CHECK). */
async function deleteAllCategories(tx: Tx, competitionId: string): Promise<void> {
  await tx.competitionCategory.updateMany({
    where: { competitionId, mergedIntoId: { not: null } },
    data: { mergedIntoId: null, status: 'CANCELLED' },
  });
  await tx.competitionCategory.deleteMany({ where: { competitionId } });
}

/** Целевая категория после объединения: объединённые границы и название с новым весом. */
function mergedTargetData(
  target: CompetitionCategory,
  before: Omit<MergeBounds, 'gender'>,
  merged: ReturnType<typeof mergedBounds>,
): Prisma.CompetitionCategoryUncheckedUpdateInput {
  return {
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
  };
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
