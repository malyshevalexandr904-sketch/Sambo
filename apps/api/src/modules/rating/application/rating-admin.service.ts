// Корректирующие операции платформы с рейтингом (ТЗ 18, 46, 65–67; docs/RATING_ARCHITECTURE.md, 6.5, 8; фаза 14).
// Только администратор платформы (права PLATFORM_SCOPE на контроллере); организатор турнира рейтинг не меняет.
// История не переписывается: ручная корректировка и применённая пересборка — новые строки rating_correction
// (с причиной и автором) и аудит с отметкой вмешательства платформы.
//  - Ручная корректировка: новый рейтинг вместо текущего, если текущий — тот, что видел администратор.
//  - Статус: FROZEN и SUSPENDED — расчёты схваток спортсмена ждут (PENDING); ACTIVE — ожидающие считаются сразу.
//    Других последствий у статусов нет до решения заказчика (ТЗ 67).
//  - Пересборка: отчёт о расхождении без записи (ТЗ 18); применение — отдельным правом и только того значения,
//    которое было в отчёте.
//  - Перерасчёт турнира: досчитать схватки с подтверждённым результатом, у которых нет завершённого расчёта
//    (ожидающие, с ошибкой, пропущенные события). Посчитанные не трогаются.
import { Injectable } from '@nestjs/common';
import type {
  AdminAthleteRating,
  Page,
  RatingCorrectionDto,
  RatingCorrectionInput,
  RatingCorrectionsQuery,
  RatingOutcome,
  RatingRebuildApply,
  RatingRebuildReport,
  RatingRecalculateInput,
  RatingRecalculationReport,
  RatingStatusChange,
} from '@sde/contracts';
import { type RatingCorrection, type RatingHistory, type Tx, uuidv7 } from '@sde/db';
import {
  type RatingRules,
  type RatingRuleSetInfo,
  type RebuildEvent,
  ratingLevel,
  replayRating,
  SAMBO_ELO_CODE,
  toRuleSetInfo,
} from '@sde/rating';
import { decodeCursor, toPage } from '../../../common/http/http';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { RatingCalculationService } from './rating-calculation.service';

const CONFIRMED_RESULT = ['CONFIRMED', 'PUBLISHED', 'AMENDED'] as const;
const FINAL = ['COMPLETED', 'SKIPPED', 'SUPERSEDED'] as const;

interface LockedRating {
  rating: number;
  status: string;
}

interface StepMeta {
  calculationId: string | null;
  correctionId: string | null;
  matchId: string | null;
  competitionId: string | null;
  calculationVersion: string | null;
  outcome: RatingOutcome | null;
  opponentRatingBefore: number | null;
  recorded: { before: number; after: number; delta: number };
}

@Injectable()
export class RatingAdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly calc: RatingCalculationService,
  ) {}

  async athlete(athleteId: string): Promise<AdminAthleteRating> {
    const profile = await this.db.athleteProfile.findUnique({
      where: { id: athleteId },
      select: { publicId: true, person: { select: { lastName: true, firstName: true } } },
    });
    if (!profile) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    const [row, pending] = await Promise.all([
      this.db.athleteRating.findUnique({ where: { athleteId } }),
      this.pendingCount(athleteId),
    ]);
    const { rules } = await this.activeRules(this.db);
    const rating = row?.rating ?? rules.initialRating;
    return {
      athleteId,
      publicId: profile.publicId,
      name: `${profile.person.lastName} ${profile.person.firstName}`,
      rating,
      level: ratingLevel(rules, rating),
      status: row?.status ?? 'ACTIVE',
      peakRating: row?.peakRating ?? rating,
      lowestRating: row?.lowestRating ?? rating,
      ratedMatches: row?.ratedMatches ?? 0,
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      pendingCalculations: pending,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async corrections(athleteId: string, q: RatingCorrectionsQuery): Promise<Page<RatingCorrectionDto>> {
    await this.ensureAthlete(this.db, athleteId);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.ratingCorrection.findMany({
      where: {
        athleteId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.k) } },
                { createdAt: new Date(cursor.k), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }), correctionDto);
  }

  /** Ручная корректировка (ТЗ 65, 66): новый рейтинг, причина, ссылка на схватку — по желанию. */
  async correct(
    athleteId: string,
    input: RatingCorrectionInput,
    userId: string,
  ): Promise<RatingCorrectionDto> {
    return this.db.tx(async (tx) => {
      await this.ensureAthlete(tx, athleteId);
      if (input.relatedMatchId) await this.ensureMatchOf(tx, input.relatedMatchId, athleteId);
      const current = await this.lock(tx, athleteId);
      if (current.rating !== input.expectedRating)
        throw new DomainError('RATING_CHANGED', { currentRating: current.rating });
      if (current.rating === input.correctedRating)
        throw new DomainError('RATING_UNCHANGED', { rating: current.rating });
      const correction = await this.apply(tx, athleteId, current.rating, input.correctedRating, {
        kind: 'MANUAL',
        reason: input.reason,
        relatedMatchId: input.relatedMatchId ?? null,
        userId,
      });
      await this.audit.record(tx, {
        action: 'rating.corrected',
        entityType: 'athlete_rating',
        entityId: athleteId,
        before: { rating: current.rating },
        after: {
          rating: input.correctedRating,
          correctionId: correction.id,
          relatedMatchId: input.relatedMatchId ?? null,
        },
        reason: input.reason,
        platformIntervention: true,
      });
      return correctionDto(correction);
    });
  }

  /** Статус рейтинга (ТЗ 67). После возврата в ACTIVE ожидающие расчёты спортсмена считаются по порядку. */
  async setStatus(athleteId: string, input: RatingStatusChange): Promise<AdminAthleteRating> {
    await this.db.tx(async (tx) => {
      await this.ensureAthlete(tx, athleteId);
      const current = await this.lock(tx, athleteId);
      if (current.status === input.status)
        throw new DomainError('RATING_UNCHANGED', { status: input.status });
      await tx.athleteRating.update({
        where: { athleteId },
        data: { status: input.status, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'rating.status_changed',
        entityType: 'athlete_rating',
        entityId: athleteId,
        before: { status: current.status },
        after: { status: input.status },
        reason: input.reason,
        platformIntervention: true,
      });
    });
    if (input.status === 'ACTIVE') await this.calc.releasePending([athleteId]);
    return this.athlete(athleteId);
  }

  /** Отчёт о расхождении (ТЗ 18; 6.5): ничего не записывает. */
  async rebuildReport(athleteId: string): Promise<RatingRebuildReport> {
    await this.ensureAthlete(this.db, athleteId);
    const row = await this.db.athleteRating.findUnique({ where: { athleteId }, select: { rating: true } });
    return this.rebuild(this.db, athleteId, row?.rating ?? null);
  }

  /**
   * Применение пересборки (`rating.rebuild_apply`): текущий рейтинг становится пересобранным — корректировкой
   * REBUILD. Применяется только значение из отчёта, который видел администратор (`expectedRating`).
   */
  async rebuildApply(
    athleteId: string,
    input: RatingRebuildApply,
    userId: string,
  ): Promise<RatingRebuildReport> {
    return this.db.tx(async (tx) => {
      await this.ensureAthlete(tx, athleteId);
      const current = await this.lock(tx, athleteId);
      // Под блокировкой рейтинга: расчёт схватки этого спортсмена ждёт её, отчёт не устареет до записи.
      const report = await this.rebuild(tx, athleteId, current.rating);
      if (report.rebuiltRating !== input.expectedRating)
        throw new DomainError('RATING_CHANGED', { rebuiltRating: report.rebuiltRating });
      if (report.discrepancy === 0) throw new DomainError('RATING_UNCHANGED', { rating: current.rating });
      const correction = await this.apply(tx, athleteId, current.rating, report.rebuiltRating, {
        kind: 'REBUILD',
        reason: input.reason,
        relatedMatchId: null,
        userId,
      });
      await this.audit.record(tx, {
        action: 'rating.rebuilt',
        entityType: 'athlete_rating',
        entityId: athleteId,
        before: { rating: current.rating },
        after: {
          rating: report.rebuiltRating,
          correctionId: correction.id,
          initialRating: report.initialRating,
          steps: report.steps.length,
        },
        reason: input.reason,
        platformIntervention: true,
      });
      return { ...report, applied: correctionDto(correction) };
    });
  }

  /** Перерасчёт турнира (ТЗ 46): схватки по порядку окончания; посчитанные не трогаются. */
  async recalculateCompetition(
    competitionId: string,
    input: RatingRecalculateInput,
  ): Promise<RatingRecalculationReport> {
    const competition = await this.db.competition.findFirst({
      where: { id: competitionId, deletedAt: null },
      select: {
        id: true,
        competitionType: true,
        organizerOrganizationId: true,
        ratingConfig: { select: { ruleSet: true } },
      },
    });
    if (!competition) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    if (competition.competitionType !== 'RATED' || !competition.ratingConfig)
      throw new DomainError('COMPETITION_NOT_RATED', { competitionId });
    const version = toRuleSetInfo(competition.ratingConfig.ruleSet).calculationVersion;
    const matches = await this.db.$queryRaw<{ id: string; final: boolean }[]>`
      SELECT m.id,
             EXISTS (
               SELECT 1 FROM rating_calculation rc
               WHERE rc.match_id = m.id AND rc.calculation_version = ${version}
                 AND rc.match_result_revision = r.revision
                 AND rc.status::text = ANY(${[...FINAL]}::text[])) AS final
      FROM match m
      JOIN match_result r ON r.match_id = m.id
      WHERE m.competition_id = ${competitionId}::uuid
        AND r.status::text = ANY(${[...CONFIRMED_RESULT]}::text[])
      ORDER BY COALESCE(m.finished_at, r.confirmed_at), m.id`;
    const report: RatingRecalculationReport = {
      competitionId,
      matches: matches.length,
      unchanged: 0,
      completed: 0,
      skipped: 0,
      pending: 0,
      failed: 0,
    };
    for (const m of matches) {
      if (m.final) {
        report.unchanged++;
        continue;
      }
      const outcome = await this.calc.calculate(m.id);
      // Посчитана параллельно (worker успел раньше) — для отчёта это «уже было».
      if (outcome.replayed) report.unchanged++;
      else if (outcome.status === 'COMPLETED') report.completed++;
      else if (outcome.status === 'SKIPPED') report.skipped++;
      else if (outcome.status === 'PENDING') report.pending++;
      else if (outcome.status === 'FAILED') report.failed++;
      else report.unchanged++;
    }
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        action: 'rating.recalculated',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        after: { ...report },
        reason: input.reason,
        platformIntervention: true,
      }),
    );
    return report;
  }

  /**
   * Пересборка от начального рейтинга версии правил первой посчитанной схватки (без схваток — действующей
   * версии): действующие расчёты по своим версиям правил и ручные корректировки по времени.
   */
  private async rebuild(db: Tx, athleteId: string, current: number | null): Promise<RatingRebuildReport> {
    const [history, corrections] = await Promise.all([
      db.ratingHistory.findMany({
        where: { athleteId, calculation: { status: 'COMPLETED' } },
        include: { calculation: { select: { ruleSetId: true } } },
      }),
      db.ratingCorrection.findMany({ where: { athleteId, kind: 'MANUAL' } }),
    ]);
    const ruleSets = new Map(
      (
        await db.ratingRuleSet.findMany({
          where: { id: { in: [...new Set(history.map((h) => h.calculation.ruleSetId))] } },
        })
      ).map((r) => [r.id, toRuleSetInfo(r)]),
    );
    const rulesOf = (id: string): RatingRuleSetInfo => {
      const r = ruleSets.get(id);
      if (!r) throw new Error(`rating_rule_set ${id} missing`);
      return r;
    };
    const events = rebuildEvents(history, corrections, (id) => rulesOf(id).rules);
    const first = [...history].sort(
      (a, b) => a.matchFinishedAt.getTime() - b.matchFinishedAt.getTime() || (a.id < b.id ? -1 : 1),
    )[0];
    const initialRating = first
      ? rulesOf(first.calculation.ruleSetId).rules.initialRating
      : (await this.activeRules(db)).rules.initialRating;
    const result = replayRating(initialRating, events);
    const currentRating = current ?? initialRating;
    return {
      athleteId,
      initialRating,
      currentRating,
      rebuiltRating: result.rating,
      discrepancy: result.rating - currentRating,
      steps: result.steps.map((s) => ({
        kind: s.event.kind,
        at: s.event.at.toISOString(),
        ...s.event.meta,
        rebuilt: { before: s.before, after: s.after, delta: s.delta },
      })),
      applied: null,
    };
  }

  /** Корректировка: новая строка и текущий рейтинг (с пиком и минимумом). */
  private async apply(
    tx: Tx,
    athleteId: string,
    before: number,
    after: number,
    c: { kind: 'MANUAL' | 'REBUILD'; reason: string; relatedMatchId: string | null; userId: string },
  ): Promise<RatingCorrection> {
    const correction = await tx.ratingCorrection.create({
      data: {
        id: uuidv7(),
        athleteId,
        kind: c.kind,
        ratingBefore: before,
        ratingAfter: after,
        delta: after - before,
        reason: c.reason,
        relatedMatchId: c.relatedMatchId,
        createdById: c.userId,
      },
    });
    await tx.$executeRaw`
      UPDATE athlete_rating SET
        rating = ${after},
        peak_rating = GREATEST(peak_rating, ${after}),
        lowest_rating = LEAST(lowest_rating, ${after}),
        version = version + 1,
        updated_at = now()
      WHERE athlete_id = ${athleteId}::uuid`;
    return correction;
  }

  /** Строка рейтинга под блокировкой; нет — создаётся с начальным рейтингом действующей версии правил. */
  private async lock(tx: Tx, athleteId: string): Promise<LockedRating> {
    const initial = (await this.activeRules(tx)).rules.initialRating;
    await tx.athleteRating.createMany({
      data: [{ athleteId, rating: initial, peakRating: initial, lowestRating: initial }],
      skipDuplicates: true,
    });
    const [row] = await tx.$queryRaw<LockedRating[]>`
      SELECT rating, status::text AS status FROM athlete_rating WHERE athlete_id = ${athleteId}::uuid FOR UPDATE`;
    if (!row) throw new Error(`athlete_rating ${athleteId} missing`);
    return row;
  }

  private async activeRules(db: Tx): Promise<RatingRuleSetInfo> {
    const row = await db.ratingRuleSet.findFirst({ where: { code: SAMBO_ELO_CODE, status: 'ACTIVE' } });
    if (!row) throw new DomainError('RATING_RULE_SET_UNAVAILABLE', { ruleSetId: null });
    return toRuleSetInfo(row);
  }

  private async ensureAthlete(db: Tx, athleteId: string): Promise<void> {
    const found = await db.athleteProfile.findUnique({ where: { id: athleteId }, select: { id: true } });
    if (!found) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
  }

  /** Схватка, в которой участвовал спортсмен. */
  private async ensureMatchOf(db: Tx, matchId: string, athleteId: string): Promise<void> {
    const found = await db.matchParticipant.findFirst({
      where: { matchId, entry: { athleteId } },
      select: { matchId: true },
    });
    if (!found) throw new DomainError('NOT_FOUND', { resource: 'match' });
  }

  private async pendingCount(athleteId: string): Promise<number> {
    const [row] = await this.db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM rating_calculation rc
      WHERE rc.status = 'PENDING'
        AND rc.input -> 'corners' @> ${JSON.stringify([{ athleteId }])}::jsonb`;
    return row?.n ?? 0;
  }
}

/** События пересборки: действующие расчёты схваток спортсмена и его ручные корректировки. */
function rebuildEvents(
  history: (RatingHistory & { calculation: { ruleSetId: string } })[],
  corrections: RatingCorrection[],
  rulesOf: (ruleSetId: string) => RatingRules,
): RebuildEvent<StepMeta>[] {
  return [
    ...history.map((h): RebuildEvent<StepMeta> => ({
      kind: 'MATCH',
      at: h.matchFinishedAt,
      id: h.id,
      rules: rulesOf(h.calculation.ruleSetId),
      outcome: h.outcome as RatingOutcome,
      opponentRatingBefore: h.opponentRatingBefore,
      meta: {
        calculationId: h.calculationId,
        correctionId: null,
        matchId: h.matchId,
        competitionId: h.competitionId,
        calculationVersion: h.calculationVersion,
        outcome: h.outcome as RatingOutcome,
        opponentRatingBefore: h.opponentRatingBefore,
        recorded: { before: h.ratingBefore, after: h.ratingAfter, delta: h.ratingDelta },
      },
    })),
    ...corrections.map((c): RebuildEvent<StepMeta> => ({
      kind: 'CORRECTION',
      at: c.createdAt,
      id: c.id,
      delta: c.delta,
      meta: {
        calculationId: null,
        correctionId: c.id,
        matchId: c.relatedMatchId,
        competitionId: null,
        calculationVersion: null,
        outcome: null,
        opponentRatingBefore: null,
        recorded: { before: c.ratingBefore, after: c.ratingAfter, delta: c.delta },
      },
    })),
  ];
}

export function correctionDto(c: RatingCorrection): RatingCorrectionDto {
  return {
    id: c.id,
    athleteId: c.athleteId,
    kind: c.kind,
    ratingBefore: c.ratingBefore,
    ratingAfter: c.ratingAfter,
    delta: c.delta,
    reason: c.reason,
    relatedMatchId: c.relatedMatchId,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
  };
}
