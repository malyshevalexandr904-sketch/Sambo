// Команды жеребьёвки (API.md, 6.1; ARCHITECTURE.md, 14.5, 16.5; ADR-11): черновик по допущенным участникам,
// публикация (сетка, схватки, категория → DRAWN), новая версия опубликованной жеребьёвки с причиной.
// Блокировки: право записи → турнир FOR SHARE → категория FOR UPDATE → версия жеребьёвки FOR UPDATE.
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type DrawCreate, type DrawDto, isDrawFormat, ratedFormatPlan } from '@sde/contracts';
import { type Draw, type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { BracketsService, strategyFor } from '../../brackets';
import { CategoryWorkflowService, type LockedCategory } from '../../categories';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { canonicalDrawInput, type DrawInput, drawInputHash, seedingIssues } from '../domain/draw-input';
import { inDrawPhase, MIN_DRAW_PARTICIPANTS } from '../domain/draw-rules';
import { computeDrawLayout, type DrawLayout } from '../domain/layout';
import { isValidRandomSeed } from '../domain/prng';
import { DrawQueriesService } from './draw-queries';
import {
  type CategoryContext,
  DrawParticipantsService,
  parseStoredInput,
  toDrawParticipant,
} from './draw-participants';

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

const invalid = (path: string, code: string, extra: Record<string, unknown> = {}): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields: [{ path, code }], ...extra });

/** 128 бит криптографического генератора (ARCHITECTURE.md, 14.5, шаг 2). */
function newRandomSeed(): string {
  for (;;) {
    const seed = randomBytes(16).toString('hex');
    if (isValidRandomSeed(seed)) return seed;
  }
}

type DrawRow = Draw;

@Injectable()
export class DrawsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly workflow: CategoryWorkflowService,
    private readonly participants: DrawParticipantsService,
    private readonly brackets: BracketsService,
    private readonly queries: DrawQueriesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async access(
    user: AuthUser,
    competitionId: string,
    permission: 'draw.create' | 'draw.publish' | 'draw.republish',
  ) {
    return this.policy.assert(user, permission, await this.competitions.scopeOf(competitionId));
  }

  /** Этап турнира — жеребьёвка (или позже), категория — готова к жеребьёвке. */
  private assertReady(locked: LockedCategory): void {
    if (!inDrawPhase(locked.competitionStatus)) throw blocked('competition_status');
    const status = locked.category.status;
    if (status === 'DRAWN')
      throw new DomainError('DRAW_ALREADY_PUBLISHED', { categoryId: locked.category.id });
    if (status !== 'READY_FOR_DRAW') throw new DomainError('CATEGORY_NOT_READY_FOR_DRAW', { status });
  }

  private formatFor(req: DrawCreate, ctx: CategoryContext): NonNullable<DrawCreate['format']> {
    // Рейтинговый турнир — один формат (docs/RATED_ONLY.md, 3): другой формат не выбирается.
    if (ctx.rated && req.format && req.format !== 'SPECIAL_GROUP_RATED')
      throw invalid('format', 'format_not_available', { suggested: 'SPECIAL_GROUP_RATED' });
    const format = req.format ?? ctx.suggestedFormat;
    if (format === 'SPECIAL_GROUP_RATED') this.assertRated(req, ctx);
    if (!isDrawFormat(format))
      throw invalid('format', 'format_not_available', { suggested: ctx.suggestedFormat });
    const issue = strategyFor(format)?.validate(ctx.admitted.length);
    if (issue) throw invalid('format', issue);
    return format;
  }

  /** Рейтинговый формат: число участников — по его правилам (ТЗ 36), посев — по рейтингу (ТЗ 27). */
  private assertRated(req: DrawCreate, ctx: CategoryContext): void {
    const plan = ratedFormatPlan(ctx.admitted.length);
    if (!plan.ok)
      throw new DomainError(plan.issue, {
        admitted: ctx.admitted.length,
        min: plan.minParticipants,
        max: plan.maxParticipants,
      });
    // Ручной посев — только новой версией жеребьёвки с причиной (ТЗ 28; фаза 14).
    if (req.seeding.length > 0) throw invalid('seeding', 'rated_seeding_by_rating');
    if (ctx.admitted.some((p) => p.rating === null))
      throw new DomainError('RATING_RULE_SET_UNAVAILABLE', { ruleSetId: null });
  }

  /** Черновик жеребьёвки: вход по допущенным участникам, расстановка по seed, отчёт о разведении. */
  async create(user: AuthUser, categoryId: string, req: DrawCreate): Promise<DrawDto> {
    const category = await this.workflow.require(categoryId);
    const { viaPlatform } = await this.access(user, category.competitionId, 'draw.create');
    const id = await this.db.tx(async (tx) => {
      const locked = await this.workflow.lockForCommand(tx, categoryId);
      this.assertReady(locked);
      const ctx = await this.participants.context(tx, locked.category);
      if (ctx.admissionPending > 0) throw blocked('admission_pending');
      if (ctx.admitted.length < MIN_DRAW_PARTICIPANTS)
        throw new DomainError('DRAW_NOT_ENOUGH_PARTICIPANTS', { admitted: ctx.admitted.length });
      const format = this.formatFor(req, ctx);
      const issues = seedingIssues(req.seeding, new Set(ctx.admitted.map((p) => p.entryId)));
      if (issues.length > 0) throw new DomainError('VALIDATION_FAILED', { fields: issues });
      const seeds = new Map(req.seeding.map((s) => [s.entryId, s.seedNumber]));
      const input = canonicalDrawInput({
        format,
        // Рейтинговый формат не разводит клубы и регионы (docs/RATED_TOURNAMENT_FORMAT.md, Q-F7).
        separation: format === 'SPECIAL_GROUP_RATED' ? [] : req.separation.by,
        participants: ctx.admitted.map((p) => toDrawParticipant(p, seeds.get(p.entryId) ?? null, format)),
      });
      const seed = { value: req.randomSeed ?? newRandomSeed(), manual: req.randomSeed !== undefined };
      const athletes = new Map(ctx.admitted.map((p) => [p.entryId, p.athleteId]));
      return this.insertDraft(tx, locked, { input, athletes }, seed, user.id, viaPlatform);
    });
    return this.queries.get(user, id);
  }

  private async insertDraft(
    tx: Tx,
    locked: LockedCategory,
    { input, athletes }: { input: DrawInput; athletes: ReadonlyMap<string, string> },
    seed: { value: string; manual: boolean },
    userId: string,
    viaPlatform: boolean,
  ): Promise<string> {
    const { category } = locked;
    const randomSeed = seed.value;
    const layout = computeDrawLayout(input, randomSeed);
    const last = await tx.draw.aggregate({ where: { categoryId: category.id }, _max: { number: true } });
    const id = uuidv7();
    const inputHash = drawInputHash(input);
    await tx.draw.create({
      data: {
        id,
        competitionId: category.competitionId,
        categoryId: category.id,
        number: (last._max.number ?? 0) + 1,
        format: input.format,
        algorithmVersion: input.algorithmVersion,
        randomSeed,
        manualSeed: seed.manual,
        inputHash,
        input: input as unknown as Prisma.InputJsonValue,
        separationReport: layout.separation as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    await tx.drawSlot.createMany({
      data: layout.slots.map((s) => ({
        id: uuidv7(),
        competitionId: category.competitionId,
        drawId: id,
        ...s,
      })),
    });
    if (input.format === 'SPECIAL_GROUP_RATED')
      await this.insertSeeds(tx, id, category.competitionId, input, layout, athletes);
    await this.audit.record(tx, {
      action: 'draw.created',
      entityType: 'Draw',
      entityId: id,
      competitionId: category.competitionId,
      after: {
        categoryId: category.id,
        format: input.format,
        randomSeed,
        manualSeed: seed.manual,
        inputHash,
        participants: input.participants.length,
        unmetSeparation: layout.separation.unmet,
      },
      platformIntervention: viaPlatform,
    });
    return id;
  }

  /** Посев рейтингового формата: номер посева и рейтинг на момент жеребьёвки (ТЗ 27). */
  private async insertSeeds(
    tx: Tx,
    drawId: string,
    competitionId: string,
    input: DrawInput,
    layout: DrawLayout,
    athletes: ReadonlyMap<string, string>,
  ): Promise<void> {
    const ratings = new Map(input.participants.map((p) => [p.entryId, p.rating]));
    await tx.tournamentSeed.createMany({
      data: layout.slots.flatMap((s) =>
        s.entryId && s.seedNumber !== null
          ? [
              {
                id: uuidv7(),
                competitionId,
                drawId,
                entryId: s.entryId,
                athleteId: athletes.get(s.entryId) as string,
                seedNumber: s.seedNumber,
                ratingAtDraw: ratings.get(s.entryId) as number,
              },
            ]
          : [],
      ),
    });
  }

  private async lockDraw(tx: Tx, drawId: string, version: number | null): Promise<DrawRow> {
    const [row] = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM draw WHERE id = ${drawId}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'draw' });
    const draw = await tx.draw.findUniqueOrThrow({ where: { id: drawId } });
    if (version !== null && draw.version !== version) throw versionConflict(draw.version);
    return draw;
  }

  /**
   * Публикация (ADR-11): вход черновика должен совпадать с текущими допущенными участниками; создаются сетка
   * и схватки, BYE решаются сразу, категория переходит в DRAWN.
   */
  async publish(user: AuthUser, drawId: string, version: number): Promise<DrawDto> {
    const summary = await this.queries.requireDraw(drawId);
    const { viaPlatform } = await this.access(user, summary.competitionId, 'draw.publish');
    await this.db.tx(async (tx) => {
      const locked = await this.workflow.lockForCommand(tx, summary.categoryId);
      if (!inDrawPhase(locked.competitionStatus)) throw blocked('competition_status');
      const draw = await this.lockDraw(tx, drawId, version);
      if (draw.status === 'PUBLISHED') throw new DomainError('DRAW_ALREADY_PUBLISHED', { drawId });
      if (draw.status !== 'DRAFT')
        throw new DomainError('INVALID_TRANSITION', { from: draw.status, to: 'PUBLISHED', allowed: [] });
      this.assertReady(locked);
      // Опубликовать можно только самый новый черновик: выбрать «удачный» из нескольких нельзя.
      const last = await tx.draw.aggregate({
        where: { categoryId: draw.categoryId },
        _max: { number: true },
      });
      if (draw.number !== last._max.number) throw blocked('newer_draft_exists');
      const ctx = await this.participants.context(tx, locked.category);
      if (ctx.admissionPending > 0) throw blocked('admission_pending');
      if (drawInputHash(this.participants.currentInput(parseStoredInput(draw.input), ctx)) !== draw.inputHash)
        throw blocked('draw_input_changed');
      const now = new Date();
      await tx.draw.update({
        where: { id: drawId },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.id, version: { increment: 1 } },
      });
      const slots = await tx.drawSlot.findMany({
        where: { drawId },
        orderBy: { position: 'asc' },
        select: { position: true, entryId: true },
      });
      await this.brackets.createFromDraw(tx, {
        drawId,
        competitionId: draw.competitionId,
        categoryId: draw.categoryId,
        format: draw.format,
        slots,
        durations: ctx.durations,
      });
      await this.workflow.systemTransition(tx, locked, 'DRAWN');
      await this.recordPublished(tx, draw, viaPlatform);
    });
    return this.queries.get(user, drawId);
  }

  private async recordPublished(tx: Tx, draw: DrawRow, viaPlatform: boolean): Promise<void> {
    await this.audit.record(tx, {
      action: 'draw.published',
      entityType: 'Draw',
      entityId: draw.id,
      competitionId: draw.competitionId,
      before: { status: 'DRAFT' },
      after: {
        status: 'PUBLISHED',
        number: draw.number,
        inputHash: draw.inputHash,
        randomSeed: draw.randomSeed,
      },
      platformIntervention: viaPlatform,
    });
    await this.outbox.enqueue(tx, {
      type: 'draw.published',
      aggregate: { type: 'Draw', id: draw.id },
      competitionId: draw.competitionId,
      payload: { drawId: draw.id, categoryId: draw.categoryId },
    });
  }

  /**
   * Новая версия опубликованной жеребьёвки (ARCHITECTURE.md, 16.5): право draw.republish, причина; ни одна
   * схватка категории не начата. Сетка и схватки удаляются, версия — SUPERSEDED, категория — READY_FOR_DRAW.
   */
  async supersede(user: AuthUser, drawId: string, version: number, reason: string): Promise<DrawDto> {
    const summary = await this.queries.requireDraw(drawId);
    const { viaPlatform } = await this.access(user, summary.competitionId, 'draw.republish');
    await this.db.tx(async (tx) => {
      const locked = await this.workflow.lockForCommand(tx, summary.categoryId);
      if (!inDrawPhase(locked.competitionStatus)) throw blocked('competition_status');
      const draw = await this.lockDraw(tx, drawId, version);
      if (draw.status !== 'PUBLISHED')
        throw new DomainError('INVALID_TRANSITION', { from: draw.status, to: 'SUPERSEDED', allowed: [] });
      if (locked.category.status !== 'DRAWN') throw blocked('matches_started');
      await this.brackets.removeForDraw(tx, drawId);
      await tx.draw.update({
        where: { id: drawId },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          supersededById: user.id,
          supersedeReason: reason,
          version: { increment: 1 },
        },
      });
      await this.workflow.systemTransition(tx, locked, 'READY_FOR_DRAW', reason);
      await this.audit.record(tx, {
        action: 'draw.superseded',
        entityType: 'Draw',
        entityId: drawId,
        competitionId: draw.competitionId,
        before: { status: 'PUBLISHED' },
        after: { status: 'SUPERSEDED' },
        reason,
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'draw.superseded',
        aggregate: { type: 'Draw', id: drawId },
        competitionId: draw.competitionId,
        payload: { drawId, categoryId: draw.categoryId },
      });
    });
    return this.queries.get(user, drawId);
  }
}
