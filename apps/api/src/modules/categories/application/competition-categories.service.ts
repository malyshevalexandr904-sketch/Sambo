// Категории турнира (API.md, 5.2; ARCHITECTURE.md, 16.2): генерация из шаблона, ручная правка, переходы,
// объединение (D-03). Снимок границ хранится в категории: правка шаблона не меняет турнир.
import { Injectable } from '@nestjs/common';
import type {
  CategoryInput,
  CategoryPatch,
  CategoriesQuery,
  CategoryTransitionRequest,
  CompetitionCategoryDto,
  CompetitionStatus,
  Page,
  PermissionCode,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
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
import { CategoryExtensions, type EntryStats } from './category-extensions';
import { blocked, lockCategory, lockCompetitionShared } from './category-locks';
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
    return lockCompetitionShared(tx, competitionId);
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
      const row = await lockCategory(tx, competitionId, categoryId, version);
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
      const row = await lockCategory(tx, competitionId, categoryId);
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
      const row = await lockCategory(tx, competitionId, categoryId, version);
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
}
