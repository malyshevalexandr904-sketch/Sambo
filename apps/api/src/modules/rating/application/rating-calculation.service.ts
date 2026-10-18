// Расчёт рейтинга по подтверждённой схватке (docs/RATING_ARCHITECTURE.md, 6.2): одна транзакция — расчёт,
// две строки истории, два текущих рейтинга, аудит и событие outbox. Повторный вызов не начисляет второй раз:
// расчёт уникален по (схватка, версия расчёта, вариант результата).
// Не здесь: тип турнира и закреплённая версия правил (фаза 8), порядок схваток спортсмена и изменённые
// результаты (фаза 6) — их решает вызывающий; сюда передаётся версия правил, по которой считать.
import { Injectable } from '@nestjs/common';
import type { RatingCalculationStatus, RatingStatus, Side } from '@sde/contracts';
import { Prisma, type Tx, uuidv7 } from '@sde/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { type AthleteRatingChange, classifyResult, rateMatch } from '../domain/elo';
import type { RatingRuleSetInfo } from './rating-rules.service';

/** Результат, который уже нельзя пересчитать иначе: завершён, пропущен (не рейтинговый) или заменён. */
const FINAL: readonly RatingCalculationStatus[] = ['COMPLETED', 'SKIPPED', 'SUPERSEDED'];
const CONFIRMED_RESULT = ['CONFIRMED', 'PUBLISHED', 'AMENDED'] as const;

export type RatingCalculationReason =
  | 'RESULT_NOT_CONFIRMED'
  | 'BYE'
  | 'NO_WINNER'
  | 'UNCLASSIFIED'
  | 'NO_ATHLETE'
  | 'SAME_ATHLETE'
  | 'ATHLETE_NOT_ACTIVE';

export interface RatingCalculationOutcome {
  /** null — результата ещё нет или он не подтверждён: расчёт не записан. */
  calculationId: string | null;
  status: RatingCalculationStatus | null;
  reason: RatingCalculationReason | null;
  /** Расчёт уже был: возвращён записанный, ничего не изменено. */
  replayed: boolean;
}

// Тип, а не интерфейс: снимок пишется в JSON-поле `input`.
type Corner = {
  side: Side;
  entryId: string;
  athleteId: string;
};

interface LockedRating {
  athlete_id: string;
  rating: number;
  status: RatingStatus;
}

@Injectable()
export class RatingCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async calculate(matchId: string, ruleSet: RatingRuleSetInfo): Promise<RatingCalculationOutcome> {
    try {
      return await this.prisma.tx((tx) => this.calculateTx(tx, matchId, ruleSet));
    } catch (e) {
      // Параллельный расчёт той же схватки успел записать свой — возвращаем его.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const done = await this.prisma.tx((tx) => this.calculateTx(tx, matchId, ruleSet));
        if (done.replayed) return done;
      }
      throw e;
    }
  }

  private async calculateTx(
    tx: Tx,
    matchId: string,
    ruleSet: RatingRuleSetInfo,
  ): Promise<RatingCalculationOutcome> {
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      include: { result: true, participants: { include: { entry: { select: { athleteId: true } } } } },
    });
    const result = match.result;
    if (!result || !(CONFIRMED_RESULT as readonly string[]).includes(result.status))
      return { calculationId: null, status: null, reason: 'RESULT_NOT_CONFIRMED', replayed: false };

    const key = {
      matchId_calculationVersion_matchResultRevision: {
        matchId,
        calculationVersion: ruleSet.calculationVersion,
        matchResultRevision: result.revision,
      },
    };
    const existing = await tx.ratingCalculation.findUnique({ where: key });
    if (existing && FINAL.includes(existing.status)) return replay(existing);

    const corners: Corner[] = match.participants
      .filter((p) => !p.isBye && p.entryId && p.entry)
      .map((p) => ({ side: p.side, entryId: p.entryId as string, athleteId: p.entry?.athleteId as string }));
    const input = {
      method: result.method,
      methodDetail: result.methodDetail,
      winnerSide: result.winnerSide,
      redScore: result.redScore,
      blueScore: result.blueScore,
      corners,
    } satisfies Prisma.InputJsonValue;
    const base = {
      matchId,
      competitionId: match.competitionId,
      ruleSetId: ruleSet.id,
      calculationVersion: ruleSet.calculationVersion,
      matchResultRevision: result.revision,
      input,
    };
    const skip = async (reason: RatingCalculationReason, status: RatingCalculationStatus = 'SKIPPED') => {
      const row = existing
        ? await tx.ratingCalculation.update({
            where: { id: existing.id },
            data: { status, statusReason: reason, input, processedAt: new Date() },
          })
        : await tx.ratingCalculation.create({
            data: { id: uuidv7(), ...base, status, statusReason: reason, processedAt: new Date() },
          });
      return { calculationId: row.id, status, reason, replayed: false };
    };

    const kind = classifyResult(ruleSet.rules, {
      method: result.method,
      methodDetail: result.methodDetail,
      hasWinner: result.winnerSide !== null,
    });
    // Сочетание, которого нет в правилах версии, — ошибка данных: FAILED виден администратору, исход не угадываем.
    if (!kind.rated) return skip(kind.reason, kind.reason === 'UNCLASSIFIED' ? 'FAILED' : 'SKIPPED');
    const winner = corners.find((c) => c.side === result.winnerSide);
    const loser = corners.find((c) => c.side !== result.winnerSide);
    if (!winner || !loser) return skip('NO_ATHLETE');
    if (winner.athleteId === loser.athleteId) return skip('SAME_ATHLETE');

    // Рейтинги обоих: недостающие — начальные из версии правил; блокировка в порядке athlete_id (без взаимных
    // блокировок при параллельных коврах, ТЗ 70).
    const initial = ruleSet.rules.initialRating;
    await tx.athleteRating.createMany({
      data: [winner, loser].map((c) => ({
        athleteId: c.athleteId,
        rating: initial,
        peakRating: initial,
        lowestRating: initial,
      })),
      skipDuplicates: true,
    });
    const locked = await tx.$queryRaw<LockedRating[]>`
      SELECT athlete_id, rating, status FROM athlete_rating
      WHERE athlete_id IN (${winner.athleteId}::uuid, ${loser.athleteId}::uuid)
      ORDER BY athlete_id FOR UPDATE`;
    // Пока ждали блокировку, ту же схватку мог посчитать другой обработчик.
    const again = await tx.ratingCalculation.findUnique({ where: key });
    if (again && FINAL.includes(again.status)) return replay(again);

    const byId = new Map(locked.map((r) => [r.athlete_id, r]));
    const w = byId.get(winner.athleteId);
    const l = byId.get(loser.athleteId);
    if (!w || !l) throw new Error(`athlete_rating rows missing for match ${matchId}`);
    // Замороженный или отстранённый спортсмен: расчёт ждёт (RATING_ARCHITECTURE.md, 6.2 п. 6; Q-A4).
    if (w.status !== 'ACTIVE' || l.status !== 'ACTIVE') return skip('ATHLETE_NOT_ACTIVE', 'PENDING');

    const change = rateMatch(ruleSet.rules, {
      winnerRating: w.rating,
      loserRating: l.rating,
      winner: kind.winner,
      loser: kind.loser,
    });
    const finishedAt = match.finishedAt ?? result.confirmedAt ?? new Date();
    const calculationId = existing?.id ?? uuidv7();
    const done = { status: 'COMPLETED' as const, statusReason: null, input, processedAt: new Date() };
    if (existing) await tx.ratingCalculation.update({ where: { id: existing.id }, data: done });
    else await tx.ratingCalculation.create({ data: { id: calculationId, ...base, ...done } });

    const rows: [Corner, Corner, AthleteRatingChange, boolean][] = [
      [winner, loser, change.winner, true],
      [loser, winner, change.loser, false],
    ];
    for (const [self, opponent, c, won] of rows) {
      await tx.ratingHistory.create({
        data: {
          id: uuidv7(),
          calculationId,
          athleteId: self.athleteId,
          competitionId: match.competitionId,
          matchId,
          ratingBefore: c.ratingBefore,
          ratingAfter: c.ratingAfter,
          ratingDelta: c.delta,
          ratingAfterExact: new Prisma.Decimal(c.ratingAfterExact).toDecimalPlaces(6),
          levelBefore: c.levelBefore,
          levelAfter: c.levelAfter,
          opponentAthleteId: opponent.athleteId,
          opponentRatingBefore: c.opponentRatingBefore,
          outcome: c.outcome,
          actualScore: new Prisma.Decimal(c.actualScore),
          expectedScore: new Prisma.Decimal(c.expectedScore).toDecimalPlaces(10),
          coefficientK: c.k,
          calculationVersion: ruleSet.calculationVersion,
          matchFinishedAt: finishedAt,
        },
      });
      await tx.$executeRaw`
        UPDATE athlete_rating SET
          rating = ${c.ratingAfter},
          peak_rating = GREATEST(peak_rating, ${c.ratingAfter}),
          lowest_rating = LEAST(lowest_rating, ${c.ratingAfter}),
          rated_matches = rated_matches + 1,
          wins = wins + ${won ? 1 : 0},
          losses = losses + ${won ? 0 : 1},
          last_rated_match_at = GREATEST(last_rated_match_at, ${finishedAt}),
          version = version + 1,
          updated_at = now()
        WHERE athlete_id = ${self.athleteId}::uuid`;
    }

    await this.audit.record(tx, {
      action: 'rating.calculated',
      entityType: 'rating_calculation',
      entityId: calculationId,
      competitionId: match.competitionId,
      after: {
        matchId,
        calculationVersion: ruleSet.calculationVersion,
        matchResultRevision: result.revision,
        winner: auditChange(winner.athleteId, change.winner),
        loser: auditChange(loser.athleteId, change.loser),
      },
    });
    await this.outbox.enqueue(tx, {
      type: 'rating.calculated',
      aggregate: { type: 'rating_calculation', id: calculationId },
      competitionId: match.competitionId,
      payload: { calculationId, matchId, athleteIds: [winner.athleteId, loser.athleteId] },
    });
    return { calculationId, status: 'COMPLETED', reason: null, replayed: false };
  }
}

function replay(row: { id: string; status: RatingCalculationStatus; statusReason: string | null }) {
  return {
    calculationId: row.id,
    status: row.status,
    reason: row.statusReason as RatingCalculationReason | null,
    replayed: true,
  };
}

const auditChange = (athleteId: string, c: AthleteRatingChange) => ({
  athleteId,
  outcome: c.outcome,
  k: c.k,
  s: c.actualScore,
  e: c.expectedScore,
  before: c.ratingBefore,
  exact: c.ratingAfterExact,
  after: c.ratingAfter,
});
