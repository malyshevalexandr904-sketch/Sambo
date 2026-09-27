// Чтение жеребьёвки (API.md, 6.1): обзор турнира, версии категории, версия со слотами и предпросмотром сетки,
// опубликованная сетка категории, проверка повтора по seed.
import { Injectable } from '@nestjs/common';
import type {
  BracketViewDto,
  CategoryBracketDto,
  CategoryDrawsDto,
  CompetitionStatus,
  DrawDto,
  DrawOverviewRow,
  DrawVerifyDto,
  PermissionCode,
} from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { BracketsService } from '../../brackets';
import { type CategoryRow, CategoryWorkflowService } from '../../categories';
import { CompetitionScopeService } from '../../competitions';
import { DRAW_ALGORITHM_VERSION, drawInputHash } from '../domain/draw-input';
import { categoryDrawActions, drawActions } from '../domain/draw-rules';
import { computeDrawLayout } from '../domain/layout';
import {
  DRAW_FULL_INCLUDE,
  DRAW_SUMMARY_SELECT,
  type DrawFullRow,
  type DrawSummaryRow,
  toDrawCategory,
  toDrawSummary,
  toParticipants,
  toSeparationDto,
  toSlotDto,
  toUserRef,
} from './draw-mapper';
import { type CategoryContext, DrawParticipantsService, parseStoredInput } from './draw-participants';

const CANDIDATES: readonly PermissionCode[] = ['draw.create', 'draw.publish', 'draw.republish'];

interface Viewer {
  perms: Set<PermissionCode>;
  competitionStatus: CompetitionStatus;
}

@Injectable()
export class DrawQueriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly workflow: CategoryWorkflowService,
    private readonly participants: DrawParticipantsService,
    private readonly brackets: BracketsService,
  ) {}

  private async viewer(user: AuthUser, competitionId: string): Promise<Viewer> {
    const competition = await this.competitions.require(competitionId);
    const scope: ResourceScope = await this.competitions.scopeFor(competition);
    return {
      perms: new Set(await this.policy.allowedActions(user, scope, CANDIDATES)),
      competitionStatus: competition.status,
    };
  }

  /** Черновик устарел: допущенные участники (или их команды) изменились после его создания. */
  private stale(row: { status: string; input: unknown; inputHash: string }, ctx: CategoryContext): boolean {
    if (row.status !== 'DRAFT') return false;
    return drawInputHash(this.participants.currentInput(parseStoredInput(row.input), ctx)) !== row.inputHash;
  }

  private summaryActions(v: Viewer, category: CategoryRow, row: DrawSummaryRow, stale: boolean): string[] {
    return drawActions({
      competitionStatus: v.competitionStatus,
      categoryStatus: category.status,
      status: row.status,
      stale,
      canPublish: v.perms.has('draw.publish'),
      canRepublish: v.perms.has('draw.republish'),
    });
  }

  /** Обзор жеребьёвки турнира: строка на каждую действующую категорию. */
  async overview(user: AuthUser, competitionId: string): Promise<DrawOverviewRow[]> {
    const v = await this.viewer(user, competitionId);
    const categories = await this.db.competitionCategory.findMany({
      where: { competitionId, status: { notIn: ['MERGED', 'CANCELLED'] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const draws = await this.db.draw.findMany({
      where: { competitionId, status: { in: ['DRAFT', 'PUBLISHED'] } },
      select: DRAW_SUMMARY_SELECT,
    });
    const contexts = await this.participants.contexts(null, competitionId, categories);
    const rows: DrawOverviewRow[] = [];
    for (const ctx of contexts) {
      const c = ctx.category;
      const published = draws.find((d) => d.categoryId === c.id && d.status === 'PUBLISHED');
      rows.push({
        category: toDrawCategory(c),
        admitted: ctx.admitted.length,
        admissionPending: ctx.admissionPending,
        suggestedFormat: ctx.suggestedFormat,
        published: published
          ? toDrawSummary(published, false, this.summaryActions(v, c, published, false))
          : null,
        drafts: draws.filter((d) => d.categoryId === c.id && d.status === 'DRAFT').length,
      });
    }
    return rows;
  }

  async categoryDraws(user: AuthUser, categoryId: string): Promise<CategoryDrawsDto> {
    const category = await this.workflow.require(categoryId);
    const v = await this.viewer(user, category.competitionId);
    const ctx = await this.participants.context(null, category);
    const rows = await this.db.draw.findMany({
      where: { categoryId },
      orderBy: { number: 'desc' },
      select: { ...DRAW_SUMMARY_SELECT, input: true, inputHash: true },
    });
    return {
      category: toDrawCategory(category),
      admitted: ctx.admitted.length,
      admissionPending: ctx.admissionPending,
      suggestedFormat: ctx.suggestedFormat,
      participants: ctx.admitted.map((p) => ({
        entryId: p.entryId,
        publicName: p.publicName,
        birthYear: p.birthYear,
        organization: p.organization,
        region: p.region,
        seedNumber: null,
        position: null,
        pool: null,
        entryStatus: p.entryStatus,
      })),
      draws: rows.map((r) => {
        const stale = this.stale(r, ctx);
        return toDrawSummary(r, stale, this.summaryActions(v, category, r, stale));
      }),
      allowedActions: categoryDrawActions({
        competitionStatus: v.competitionStatus,
        categoryStatus: category.status,
        admitted: ctx.admitted.length,
        canCreate: v.perms.has('draw.create'),
      }),
    };
  }

  async requireDraw(drawId: string | undefined, tx?: Tx): Promise<DrawFullRow> {
    const row = drawId
      ? await (tx ?? this.db).draw.findUnique({ where: { id: drawId }, include: DRAW_FULL_INCLUDE })
      : null;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'draw' });
    return row;
  }

  async get(user: AuthUser, drawId: string): Promise<DrawDto> {
    const row = await this.requireDraw(drawId);
    const category = await this.workflow.require(row.categoryId);
    const v = await this.viewer(user, row.competitionId);
    const ctx = await this.participants.context(null, category);
    const stale = this.stale(row, ctx);
    const slots = row.slots.map(toSlotDto);
    const infos = await this.participants.infos(
      null,
      slots.flatMap((s) => (s.entryId ? [s.entryId] : [])),
    );
    const participants = toParticipants(slots, infos);
    const nodes =
      (row.status === 'PUBLISHED' ? await this.brackets.view(row.id) : null) ??
      this.brackets.preview(row.format, row.slots);
    return {
      ...toDrawSummary(row, stale, this.summaryActions(v, category, row, stale)),
      competitionId: row.competitionId,
      algorithmVersion: row.algorithmVersion,
      randomSeed: row.randomSeed,
      inputHash: row.inputHash,
      separation: toSeparationDto(row.separationReport, infos),
      slots,
      createdBy: toUserRef(row.createdBy),
      publishedBy: toUserRef(row.publishedBy),
      supersededBy: toUserRef(row.supersededBy),
      supersedeReason: row.supersedeReason,
      bracket: { format: row.format, size: slots.length, nodes, participants },
    };
  }

  /** Сетка категории по опубликованной жеребьёвке (API.md, 6.1: GET /categories/{id}/brackets). */
  async bracket(user: AuthUser, categoryId: string): Promise<CategoryBracketDto> {
    const category = await this.workflow.require(categoryId);
    const v = await this.viewer(user, category.competitionId);
    const row = await this.db.draw.findFirst({
      where: { categoryId, status: 'PUBLISHED' },
      include: DRAW_FULL_INCLUDE,
    });
    if (!row) return { category: toDrawCategory(category), draw: null, bracket: null };
    const slots = row.slots.map(toSlotDto);
    const infos = await this.participants.infos(
      null,
      slots.flatMap((s) => (s.entryId ? [s.entryId] : [])),
    );
    const nodes = await this.brackets.view(row.id);
    const bracket: BracketViewDto | null = nodes
      ? { format: row.format, size: slots.length, nodes, participants: toParticipants(slots, infos) }
      : null;
    return {
      category: toDrawCategory(category),
      draw: toDrawSummary(row, false, this.summaryActions(v, category, row, false)),
      bracket,
    };
  }

  /** Повтор по seed и сохранённому входу (ADR-11): та же расстановка, тот же хеш входа, текущие ли участники. */
  async verify(drawId: string): Promise<DrawVerifyDto> {
    const row = await this.requireDraw(drawId);
    const input = parseStoredInput(row.input);
    const category = await this.workflow.require(row.categoryId);
    const ctx = await this.participants.context(null, category);
    const inputHashMatches = drawInputHash(input) === row.inputHash;
    const supported = row.algorithmVersion === DRAW_ALGORITHM_VERSION;
    const layout = supported ? computeDrawLayout(input, row.randomSeed) : null;
    const slotsMatch =
      layout !== null &&
      layout.slots.length === row.slots.length &&
      layout.slots.every((s, i) => {
        const saved = row.slots[i];
        return (
          saved?.position === s.position &&
          saved.entryId === s.entryId &&
          saved.seedNumber === s.seedNumber &&
          (saved.pool ?? null) === s.pool
        );
      });
    return {
      reproducible: inputHashMatches && slotsMatch,
      inputHashMatches,
      slotsMatch,
      currentInput: drawInputHash(this.participants.currentInput(input, ctx)) === row.inputHash,
      algorithmVersion: row.algorithmVersion,
    };
  }
}
