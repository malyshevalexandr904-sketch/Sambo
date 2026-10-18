// Расчёт рейтинга по подтверждённой схватке (docs/RATING_ARCHITECTURE.md, 6) — общий для worker (события
// подтверждения и изменения результата) и api (повтор администратором). Одна транзакция: расчёт, две строки
// истории, два текущих рейтинга, аудит и событие outbox. Повторный вызов не начисляет второй раз: расчёт уникален
// по (схватка, версия расчёта, вариант результата).
//  - Турнир NON_RATED — ничего не пишется. Версия правил — закреплённая турниром (CompetitionRatingConfig).
//  - Схватки спортсмена считаются по порядку (6.2 п. 5): есть более ранняя рейтинговая схватка без расчёта —
//    расчёт ждёт (PENDING) и отпускается, когда посчитана она.
//  - Изменённый результат уже посчитанной схватки (6.4): прежний расчёт — SUPERSEDED, новый считается от тех же
//    рейтингов до схватки, разница к начисленному — корректировка текущего рейтинга (RatingCorrection). История не
//    переписывается, последующие схватки не пересчитываются.
import {
  type AuditAction,
  type EventPayload,
  type RatingCalculationStatus,
  type RatingStatus,
  type Side,
} from '@sde/contracts';
import { Prisma, type RatingCalculation, type Tx, uuidv7 } from '@sde/db';
import { type AthleteRatingChange, classifyResult, isWinOutcome, rateMatch } from './elo.js';
import { type RatingRuleSetInfo, toRuleSetInfo } from './rule-sets.js';

/** Расчёт, который уже нельзя пересчитать иначе: завершён, пропущен (не рейтинговый) или заменён. */
const FINAL: readonly RatingCalculationStatus[] = ['COMPLETED', 'SKIPPED', 'SUPERSEDED'];
const CONFIRMED_RESULT: readonly string[] = ['CONFIRMED', 'PUBLISHED', 'AMENDED'];
/** Сколько ожидающих расчётов отпускается за один вызов. */
const RELEASE_LIMIT = 100;

export type RatingCalculationReason =
  | 'NOT_RATED'
  | 'NO_RULE_SET'
  | 'RESULT_NOT_CONFIRMED'
  | 'BYE'
  | 'NO_WINNER'
  | 'UNCLASSIFIED'
  | 'NO_ATHLETE'
  | 'SAME_ATHLETE'
  | 'ATHLETE_NOT_ACTIVE'
  | 'EARLIER_MATCH_PENDING';

export interface RatingCalculationOutcome {
  /** null — турнир не рейтинговый или результат не подтверждён: расчёт не записан. */
  calculationId: string | null;
  status: RatingCalculationStatus | null;
  reason: RatingCalculationReason | null;
  /** Расчёт уже был: возвращён записанный, ничего не изменено. */
  replayed: boolean;
  /** Спортсмены схватки: после расчёта отпускаются их ожидающие схватки. */
  athleteIds: string[];
}

export interface RatingAuditEntry {
  action: Extract<AuditAction, 'rating.calculated' | 'rating.amended'>;
  entityType: string;
  entityId: string;
  competitionId: string;
  after: Record<string, unknown>;
}

export interface RatingEventEntry {
  type: 'rating.calculated';
  aggregate: { type: string; id: string };
  competitionId: string;
  payload: EventPayload<'rating.calculated'>;
}

/** Аудит и outbox в транзакции расчёта: в api — AuditService и OutboxService, в worker — от имени системы. */
export interface RatingSink {
  record(tx: Tx, entry: RatingAuditEntry): Promise<void>;
  enqueue(tx: Tx, event: RatingEventEntry): Promise<unknown>;
}

/** Транзакция READ COMMITTED (блокировки строк рейтинга — явные). */
export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

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

type MatchForRating = Prisma.MatchGetPayload<{
  include: {
    result: true;
    participants: { include: { entry: { select: { athleteId: true } } } };
    competition: { select: { competitionType: true; ratingConfig: { include: { ruleSet: true } } } };
  };
}>;

/** Всё, что нужно записи расчёта текущего варианта результата. */
interface Draft {
  match: MatchForRating;
  result: NonNullable<MatchForRating['result']>;
  ruleSet: RatingRuleSetInfo;
  corners: Corner[];
  existing: RatingCalculation | null;
  base: {
    matchId: string;
    competitionId: string;
    ruleSetId: string;
    calculationVersion: string;
    matchResultRevision: number;
    input: Prisma.InputJsonValue;
  };
}

export class RatingCalculator {
  constructor(
    private readonly run: TxRunner,
    private readonly sink: RatingSink,
  ) {}

  async calculate(matchId: string): Promise<RatingCalculationOutcome> {
    try {
      return await this.run((tx) => this.calculateTx(tx, matchId));
    } catch (e) {
      // Параллельный расчёт той же схватки успел записать свой — возвращаем его.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const done = await this.run((tx) => this.calculateTx(tx, matchId));
        if (done.replayed) return done;
      }
      throw e;
    }
  }

  /**
   * Ожидающие расчёты спортсменов — по порядку схваток. Посчитанная схватка отпускает схватки своих спортсменов;
   * схватка, которая всё ещё ждёт, остаётся PENDING до следующего вызова.
   */
  async releasePending(athleteIds: readonly string[]): Promise<RatingCalculationOutcome[]> {
    const outcomes: RatingCalculationOutcome[] = [];
    const tried = new Set<string>();
    let athletes = new Set(athleteIds);
    while (athletes.size > 0 && outcomes.length < RELEASE_LIMIT) {
      const matchIds = await this.run((tx) => pendingMatches(tx, [...athletes], RELEASE_LIMIT));
      athletes = new Set();
      for (const matchId of matchIds) {
        if (tried.has(matchId)) continue;
        tried.add(matchId);
        const outcome = await this.calculate(matchId);
        outcomes.push(outcome);
        if (outcome.status !== 'PENDING') for (const id of outcome.athleteIds) athletes.add(id);
      }
    }
    return outcomes;
  }

  /** Все ожидающие расчёты по порядку схваток (регламентная задача: разморозка, пропущенные события). */
  async sweepPending(limit = 200): Promise<RatingCalculationOutcome[]> {
    const matchIds = await this.run((tx) => pendingMatches(tx, null, limit));
    const outcomes: RatingCalculationOutcome[] = [];
    for (const matchId of matchIds) outcomes.push(await this.calculate(matchId));
    return outcomes;
  }

  private async calculateTx(tx: Tx, matchId: string): Promise<RatingCalculationOutcome> {
    const match = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        result: true,
        participants: { include: { entry: { select: { athleteId: true } } } },
        competition: {
          select: { competitionType: true, ratingConfig: { include: { ruleSet: true } } },
        },
      },
    });
    const corners: Corner[] = match.participants
      .filter((p) => !p.isBye && p.entryId && p.entry)
      .map((p) => ({ side: p.side, entryId: p.entryId as string, athleteId: p.entry?.athleteId as string }));
    const athleteIds = corners.map((c) => c.athleteId);
    const none = (reason: RatingCalculationReason): RatingCalculationOutcome => ({
      calculationId: null,
      status: null,
      reason,
      replayed: false,
      athleteIds,
    });

    if (match.competition.competitionType !== 'RATED') return none('NOT_RATED');
    const config = match.competition.ratingConfig;
    if (!config) return none('NO_RULE_SET');
    const ruleSet = toRuleSetInfo(config.ruleSet);
    const result = match.result;
    if (!result || !CONFIRMED_RESULT.includes(result.status)) return none('RESULT_NOT_CONFIRMED');

    const existing = await this.current(tx, matchId, ruleSet, result.revision);
    if (existing && FINAL.includes(existing.status)) return replay(existing, athleteIds);

    const draft: Draft = {
      match,
      result,
      ruleSet,
      corners,
      existing,
      base: {
        matchId,
        competitionId: match.competitionId,
        ruleSetId: ruleSet.id,
        calculationVersion: ruleSet.calculationVersion,
        matchResultRevision: result.revision,
        input: {
          method: result.method,
          methodDetail: result.methodDetail,
          winnerSide: result.winnerSide,
          redScore: result.redScore,
          blueScore: result.blueScore,
          corners,
        },
      },
    };
    // Прежний вариант результата уже начислен — перерасчёт от тех же рейтингов до схватки (6.4).
    const previous = await tx.ratingCalculation.findFirst({
      where: { matchId, status: 'COMPLETED', matchResultRevision: { lt: result.revision } },
    });
    return previous ? this.amendTx(tx, draft, previous) : this.rateTx(tx, draft);
  }

  /** Первый расчёт схватки: от текущих рейтингов спортсменов. */
  private async rateTx(tx: Tx, d: Draft): Promise<RatingCalculationOutcome> {
    const { match, result, ruleSet, corners } = d;
    const athleteIds = corners.map((c) => c.athleteId);
    const kind = classifyResult(ruleSet.rules, {
      method: result.method,
      methodDetail: result.methodDetail,
      hasWinner: result.winnerSide !== null,
    });
    // Сочетание, которого нет в правилах версии, — ошибка данных: FAILED виден администратору, исход не угадываем.
    if (!kind.rated)
      return this.store(tx, d, kind.reason === 'UNCLASSIFIED' ? 'FAILED' : 'SKIPPED', kind.reason);
    const winner = corners.find((c) => c.side === result.winnerSide);
    const loser = corners.find((c) => c.side !== result.winnerSide);
    if (!winner || !loser) return this.store(tx, d, 'SKIPPED', 'NO_ATHLETE');
    if (winner.athleteId === loser.athleteId) return this.store(tx, d, 'SKIPPED', 'SAME_ATHLETE');

    // Рейтинги обоих: недостающие — начальные из версии правил.
    const initial = ruleSet.rules.initialRating;
    await tx.athleteRating.createMany({
      data: athleteIds.map((athleteId) => ({
        athleteId,
        rating: initial,
        peakRating: initial,
        lowestRating: initial,
      })),
      skipDuplicates: true,
    });
    const locked = await lockRatings(tx, athleteIds);
    // Пока ждали блокировку, ту же схватку мог посчитать другой обработчик.
    const again = await this.current(tx, match.id, ruleSet, result.revision);
    if (again && FINAL.includes(again.status)) return replay(again, athleteIds);
    const w = locked.get(winner.athleteId);
    const l = locked.get(loser.athleteId);
    if (!w || !l) throw new Error(`athlete_rating rows missing for match ${match.id}`);
    // Замороженный или отстранённый спортсмен: расчёт ждёт (6.2 п. 6; Q-A4).
    if (w.status !== 'ACTIVE' || l.status !== 'ACTIVE')
      return this.store(tx, { ...d, existing: again }, 'PENDING', 'ATHLETE_NOT_ACTIVE');
    // Порядок схваток (6.2 п. 5): проверка под блокировкой рейтингов обоих — расчёт более ранней схватки этих
    // спортсменов либо уже виден, либо ещё не начат и увидит этот расчёт ожидающим.
    const finishedAt = finishedAtOf(d);
    if (await hasEarlierUnrated(tx, match.id, finishedAt, athleteIds))
      return this.store(tx, { ...d, existing: again }, 'PENDING', 'EARLIER_MATCH_PENDING');

    const change = rateMatch(ruleSet.rules, {
      winnerRating: w.rating,
      loserRating: l.rating,
      winner: kind.winner,
      loser: kind.loser,
    });
    const { calculationId } = await this.store(tx, { ...d, existing: again }, 'COMPLETED', null);
    await this.writeHistory(tx, d, calculationId, finishedAt, winner, loser, change);
    for (const [self, c, won] of [
      [winner, change.winner, true],
      [loser, change.loser, false],
    ] as const) {
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

    await this.sink.record(tx, {
      action: 'rating.calculated',
      entityType: 'rating_calculation',
      entityId: calculationId,
      competitionId: match.competitionId,
      after: {
        matchId: match.id,
        calculationVersion: ruleSet.calculationVersion,
        matchResultRevision: result.revision,
        winner: auditChange(winner.athleteId, change.winner),
        loser: auditChange(loser.athleteId, change.loser),
      },
    });
    await this.sink.enqueue(tx, {
      type: 'rating.calculated',
      aggregate: { type: 'rating_calculation', id: calculationId },
      competitionId: match.competitionId,
      payload: { calculationId, matchId: match.id, athleteIds: [winner.athleteId, loser.athleteId] },
    });
    return { calculationId, status: 'COMPLETED', reason: null, replayed: false, athleteIds };
  }

  /**
   * Изменённый результат посчитанной схватки (6.4; Q-A1): новый вариант считается от рейтингов до схватки из
   * прежней истории, прежний расчёт заменяется, текущие рейтинги получают разницу как корректировку.
   */
  private async amendTx(tx: Tx, d: Draft, previous: RatingCalculation): Promise<RatingCalculationOutcome> {
    const { match, result, ruleSet, corners } = d;
    const old = await tx.ratingHistory.findMany({ where: { calculationId: previous.id } });
    const athleteIds = old.map((h) => h.athleteId).sort();
    const locked = await lockRatings(tx, athleteIds);
    const again = await this.current(tx, match.id, ruleSet, result.revision);
    if (again && FINAL.includes(again.status)) return replay(again, athleteIds);
    const prev = await tx.ratingCalculation.findUniqueOrThrow({ where: { id: previous.id } });
    // Прежний расчёт заменил параллельный обработчик более нового варианта — повтор задачи прочитает его.
    if (prev.status !== 'COMPLETED') throw new Error(`rating_calculation ${prev.id} changed concurrently`);
    if ([...locked.values()].some((r) => r.status !== 'ACTIVE'))
      return this.store(tx, { ...d, existing: again }, 'PENDING', 'ATHLETE_NOT_ACTIVE');

    const before = new Map(old.map((h) => [h.athleteId, h]));
    const kind = classifyResult(ruleSet.rules, {
      method: result.method,
      methodDetail: result.methodDetail,
      hasWinner: result.winnerSide !== null,
    });
    let change: { winner: AthleteRatingChange; loser: AthleteRatingChange } | null = null;
    let winner: Corner | undefined;
    let loser: Corner | undefined;
    let status: RatingCalculationStatus = 'COMPLETED';
    let reason: RatingCalculationReason | null = null;
    if (!kind.rated) {
      status = kind.reason === 'UNCLASSIFIED' ? 'FAILED' : 'SKIPPED';
      reason = kind.reason;
    } else {
      winner = corners.find((c) => c.side === result.winnerSide);
      loser = corners.find((c) => c.side !== result.winnerSide);
      const w = winner && before.get(winner.athleteId);
      const l = loser && before.get(loser.athleteId);
      if (!winner || !loser || !w || !l || winner.athleteId === loser.athleteId)
        throw new Error(`match ${match.id}: athletes differ from the rated result`);
      change = rateMatch(ruleSet.rules, {
        winnerRating: w.ratingBefore,
        loserRating: l.ratingBefore,
        winner: kind.winner,
        loser: kind.loser,
      });
    }

    const processedAt = new Date();
    // Сначала замена прежнего: у схватки один завершённый расчёт (rating_calculation_one_completed_key).
    await tx.ratingCalculation.update({
      where: { id: previous.id },
      data: { status: 'SUPERSEDED', statusReason: 'RESULT_AMENDED', processedAt },
    });
    const { calculationId } = await this.store(tx, { ...d, existing: again }, status, reason);
    if (change && winner && loser) {
      const finishedAt = old[0]?.matchFinishedAt ?? finishedAtOf(d);
      await this.writeHistory(tx, d, calculationId, finishedAt, winner, loser, change);
    }

    const athletes = [];
    for (const athleteId of athleteIds) {
      const was = before.get(athleteId);
      const current = locked.get(athleteId);
      if (!was || !current) throw new Error(`rating rows missing for match ${match.id}`);
      const now = change && (athleteId === winner?.athleteId ? change.winner : change.loser);
      const wonBefore = isWinOutcome(was.outcome);
      const wonNow = now ? athleteId === winner?.athleteId : false;
      const delta = (now?.delta ?? 0) - was.ratingDelta;
      const ratingAfter = current.rating + delta;
      await tx.$executeRaw`
        UPDATE athlete_rating SET
          rating = ${ratingAfter},
          peak_rating = GREATEST(peak_rating, ${ratingAfter}),
          lowest_rating = LEAST(lowest_rating, ${ratingAfter}),
          rated_matches = rated_matches + ${now ? 0 : -1},
          wins = wins + ${(wonNow ? 1 : 0) - (wonBefore ? 1 : 0)},
          losses = losses + ${(now && !wonNow ? 1 : 0) - (wonBefore ? 0 : 1)},
          version = version + 1,
          updated_at = now()
        WHERE athlete_id = ${athleteId}::uuid`;
      await tx.ratingCorrection.create({
        data: {
          id: uuidv7(),
          athleteId,
          kind: 'RESULT_AMENDED',
          calculationId,
          supersededCalculationId: previous.id,
          ratingBefore: current.rating,
          ratingAfter,
          delta,
          reason: `match_result revision ${previous.matchResultRevision} -> ${result.revision}`,
        },
      });
      athletes.push({
        athleteId,
        deltaBefore: was.ratingDelta,
        deltaNow: now?.delta ?? null,
        correction: delta,
        ratingBefore: current.rating,
        ratingAfter,
      });
    }

    await this.sink.record(tx, {
      action: 'rating.amended',
      entityType: 'rating_calculation',
      entityId: calculationId,
      competitionId: match.competitionId,
      after: {
        matchId: match.id,
        calculationVersion: ruleSet.calculationVersion,
        matchResultRevision: result.revision,
        supersededCalculationId: previous.id,
        status,
        reason,
        athletes,
      },
    });
    await this.sink.enqueue(tx, {
      type: 'rating.calculated',
      aggregate: { type: 'rating_calculation', id: calculationId },
      competitionId: match.competitionId,
      payload: {
        calculationId,
        matchId: match.id,
        athleteIds: winner && loser ? [winner.athleteId, loser.athleteId] : athleteIds,
        supersededCalculationId: previous.id,
      },
    });
    return { calculationId, status, reason, replayed: false, athleteIds };
  }

  /** Расчёт текущего варианта результата для версии правил турнира. */
  private current(
    tx: Tx,
    matchId: string,
    ruleSet: RatingRuleSetInfo,
    revision: number,
  ): Promise<RatingCalculation | null> {
    return tx.ratingCalculation.findUnique({
      where: {
        matchId_calculationVersion_matchResultRevision: {
          matchId,
          calculationVersion: ruleSet.calculationVersion,
          matchResultRevision: revision,
        },
      },
    });
  }

  /**
   * Запись расчёта текущего варианта (новая или поверх ожидающей); незавершённые расчёты прежних вариантов
   * результата больше не нужны — SUPERSEDED.
   */
  private async store(
    tx: Tx,
    d: Draft,
    status: RatingCalculationStatus,
    reason: RatingCalculationReason | null,
  ): Promise<RatingCalculationOutcome & { calculationId: string }> {
    const processedAt = status === 'PENDING' ? null : new Date();
    await tx.ratingCalculation.updateMany({
      where: {
        matchId: d.base.matchId,
        matchResultRevision: { lt: d.base.matchResultRevision },
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: { status: 'SUPERSEDED', statusReason: 'RESULT_AMENDED', processedAt: new Date() },
    });
    const data = { status, statusReason: reason, input: d.base.input, processedAt };
    const row = d.existing
      ? await tx.ratingCalculation.update({ where: { id: d.existing.id }, data })
      : await tx.ratingCalculation.create({ data: { id: uuidv7(), ...d.base, ...data } });
    return {
      calculationId: row.id,
      status,
      reason,
      replayed: false,
      athleteIds: d.corners.map((c) => c.athleteId),
    };
  }

  private async writeHistory(
    tx: Tx,
    d: Draft,
    calculationId: string,
    finishedAt: Date,
    winner: Corner,
    loser: Corner,
    change: { winner: AthleteRatingChange; loser: AthleteRatingChange },
  ): Promise<void> {
    for (const [self, opponent, c] of [
      [winner, loser, change.winner],
      [loser, winner, change.loser],
    ] as const) {
      await tx.ratingHistory.create({
        data: {
          id: uuidv7(),
          calculationId,
          athleteId: self.athleteId,
          competitionId: d.match.competitionId,
          matchId: d.match.id,
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
          calculationVersion: d.ruleSet.calculationVersion,
          matchFinishedAt: finishedAt,
        },
      });
    }
  }
}

/** Блокировка строк рейтинга в порядке athlete_id — без взаимных блокировок при параллельных коврах (ТЗ 70). */
async function lockRatings(tx: Tx, athleteIds: readonly string[]): Promise<Map<string, LockedRating>> {
  const rows = await tx.$queryRaw<LockedRating[]>`
    SELECT athlete_id, rating, status FROM athlete_rating
    WHERE athlete_id = ANY(${[...athleteIds]}::uuid[])
    ORDER BY athlete_id FOR UPDATE`;
  return new Map(rows.map((r) => [r.athlete_id, r]));
}

/** Время схватки для порядка расчётов: окончание, без него — подтверждение результата. */
const finishedAtOf = (d: Draft): Date => d.match.finishedAt ?? d.result.confirmedAt ?? new Date();

/**
 * Есть ли у спортсменов более ранняя (по окончанию, затем по id) схватка рейтингового турнира с результатом, ещё
 * не посчитанная в его текущем варианте. Посчитанная с ошибкой (FAILED) не держит очередь — её видит администратор.
 */
async function hasEarlierUnrated(
  tx: Tx,
  matchId: string,
  finishedAt: Date,
  athleteIds: readonly string[],
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT m.id FROM match m
    JOIN match_participant mp ON mp.match_id = m.id
    JOIN entry e ON e.id = mp.entry_id
    JOIN match_result r ON r.match_id = m.id
    JOIN competition c ON c.id = m.competition_id
    WHERE e.athlete_id = ANY(${[...athleteIds]}::uuid[])
      AND c.competition_type = 'RATED'
      AND m.id <> ${matchId}::uuid
      AND (COALESCE(m.finished_at, r.confirmed_at), m.id) < (${finishedAt}::timestamptz, ${matchId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM rating_calculation rc
        WHERE rc.match_id = m.id AND rc.match_result_revision = r.revision AND rc.status <> 'PENDING')
    LIMIT 1`;
  return rows.length > 0;
}

/** Схватки с ожидающим расчётом (всех или указанных спортсменов) — по порядку схваток. */
async function pendingMatches(
  tx: Tx,
  athleteIds: readonly string[] | null,
  limit: number,
): Promise<string[]> {
  const filter =
    athleteIds === null
      ? Prisma.empty
      : Prisma.sql`AND rc.input -> 'corners' @> ANY(${athleteIds.map((id) =>
          JSON.stringify([{ athleteId: id }]),
        )}::jsonb[])`;
  const rows = await tx.$queryRaw<{ match_id: string }[]>`
    SELECT rc.match_id FROM rating_calculation rc
    JOIN match m ON m.id = rc.match_id
    LEFT JOIN match_result r ON r.match_id = m.id
    WHERE rc.status = 'PENDING' ${filter}
    ORDER BY COALESCE(m.finished_at, r.confirmed_at), m.id
    LIMIT ${limit}`;
  return [...new Set(rows.map((r) => r.match_id))];
}

function replay(row: RatingCalculation, athleteIds: string[]): RatingCalculationOutcome {
  return {
    calculationId: row.id,
    status: row.status,
    reason: row.statusReason as RatingCalculationReason | null,
    replayed: true,
    athleteIds,
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
