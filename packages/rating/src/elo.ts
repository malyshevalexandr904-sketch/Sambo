// Расчёт рейтинга после схватки (docs/RATING_RULES.md, 1–5): Elo, K по рейтингу спортсмена, S по исходу,
// десятичная арифметика без float; рейтинг после схватки — целое по правилу округления версии.
import type { WinMethod } from '@sde/contracts';
import Decimal from 'decimal.js';
import {
  RATING_OUTCOMES,
  type RatingOutcome,
  type RatingRules,
  type RatingWinKind,
  type RoundingRule,
} from './rules.js';

/** Своя копия decimal.js: 34 значащих цифры, половина — от нуля; глобальные настройки не трогаются. */
export const Dec = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

const WIN: Record<RatingWinKind, RatingOutcome> = {
  CLEAN: 'CLEAN_WIN',
  POINTS: 'WIN_ON_POINTS',
  SMALL_ADVANTAGE: 'WIN_SMALL_ADVANTAGE',
  MINIMAL_ADVANTAGE: 'WIN_MINIMAL_ADVANTAGE',
};
const LOSS: Record<RatingWinKind, RatingOutcome> = {
  CLEAN: 'CLEAN_LOSS',
  POINTS: 'LOSS_ON_POINTS',
  SMALL_ADVANTAGE: 'LOSS_SMALL_ADVANTAGE',
  MINIMAL_ADVANTAGE: 'LOSS_MINIMAL_ADVANTAGE',
};

/** E_A = 1 / (10^((R_B − R_A) / 400) + 1). */
export function expectedScore(rating: number, opponentRating: number): Dec {
  const exponent = new Dec(opponentRating).minus(rating).div(400);
  return new Dec(1).div(new Dec(10).pow(exponent).plus(1));
}

/** K по рейтингу спортсмена до схватки: первая строка, где рейтинг не выше порога. */
export function kFactor(rules: RatingRules, rating: number): number {
  const row = rules.kFactorRules.find((r) => r.maxRating === null || rating <= r.maxRating);
  if (!row) throw new Error(`no K-factor rule for rating ${rating}`);
  return row.k;
}

export function actualScore(rules: RatingRules, outcome: RatingOutcome): Dec {
  return new Dec(rules.scoreRules[outcome]);
}

/** Уровень — последний порог, который рейтинг достиг. */
export function ratingLevel(rules: RatingRules, rating: number): number {
  let level = rules.levelRules[0]?.level ?? 1;
  for (const row of rules.levelRules) if (row.from === null || rating >= row.from) level = row.level;
  return level;
}

export function roundRating(rule: RoundingRule, value: Dec): number {
  switch (rule) {
    case 'INTEGER_HALF_UP':
      return value.toDecimalPlaces(0, Dec.ROUND_HALF_UP).toNumber();
  }
}

export type MatchClassification =
  | { rated: true; winner: RatingOutcome; loser: RatingOutcome }
  | { rated: false; reason: 'BYE' | 'NO_WINNER' | 'UNCLASSIFIED' };

/**
 * Исход подтверждённого результата для обоих спортсменов (RATING_RULES.md, 3.1). BYE и схватка без победителя
 * не рейтинговые; сочетание, которого нет в правилах версии, — UNCLASSIFIED (расчёт не угадывает исход).
 */
export function classifyResult(
  rules: RatingRules,
  result: { method: WinMethod; methodDetail: string | null; hasWinner: boolean },
): MatchClassification {
  if (result.method === 'BYE') return { rated: false, reason: 'BYE' };
  if (!result.hasWinner) return { rated: false, reason: 'NO_WINNER' };
  const detail = result.methodDetail || null;
  const row = rules.outcomeRules.find(
    (r) => r.method === result.method && (r.methodDetail === undefined || r.methodDetail === detail),
  );
  return row
    ? { rated: true, winner: WIN[row.kind], loser: LOSS[row.kind] }
    : { rated: false, reason: 'UNCLASSIFIED' };
}

export interface AthleteRatingChange {
  ratingBefore: number;
  opponentRatingBefore: number;
  outcome: RatingOutcome;
  k: number;
  /** Десятичные строки: S, E и рейтинг до округления — для истории и аудита. */
  actualScore: string;
  expectedScore: string;
  ratingAfterExact: string;
  ratingAfter: number;
  delta: number;
  levelBefore: number;
  levelAfter: number;
}

function change(
  rules: RatingRules,
  rating: number,
  opponent: number,
  outcome: RatingOutcome,
): AthleteRatingChange {
  const e = expectedScore(rating, opponent);
  const s = actualScore(rules, outcome);
  const k = kFactor(rules, rating);
  const exact = new Dec(rating).plus(new Dec(k).times(s.minus(e)));
  const ratingAfter = roundRating(rules.roundingRule, exact);
  return {
    ratingBefore: rating,
    opponentRatingBefore: opponent,
    outcome,
    k,
    actualScore: s.toString(),
    expectedScore: e.toString(),
    ratingAfterExact: exact.toString(),
    ratingAfter,
    delta: ratingAfter - rating,
    levelBefore: ratingLevel(rules, rating),
    levelAfter: ratingLevel(rules, ratingAfter),
  };
}

/** Новые рейтинги победителя и проигравшего по рейтингам до схватки (у каждого свой K). */
export function rateMatch(
  rules: RatingRules,
  input: { winnerRating: number; loserRating: number; winner: RatingOutcome; loser: RatingOutcome },
): { winner: AthleteRatingChange; loser: AthleteRatingChange } {
  for (const r of [input.winnerRating, input.loserRating])
    if (!Number.isSafeInteger(r)) throw new Error(`rating must be an integer, got ${r}`);
  return {
    winner: change(rules, input.winnerRating, input.loserRating, input.winner),
    loser: change(rules, input.loserRating, input.winnerRating, input.loser),
  };
}

/** Исход — победа: первая половина RATING_OUTCOMES (поражения зеркальны). */
export function isWinOutcome(outcome: string): boolean {
  const i = (RATING_OUTCOMES as readonly string[]).indexOf(outcome);
  if (i < 0) throw new Error(`unknown rating outcome ${outcome}`);
  return i < RATING_OUTCOMES.length / 2;
}
