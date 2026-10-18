// Правила расчёта рейтинга (docs/RATING_RULES.md). Версия правил — данные (RatingRuleSet), здесь — их форма
// и первая версия «sambo-elo@1» (Приложение 5 + правила вида спорта «самбо», приказ Минспорта № 892).
import type { WinMethod } from '@sde/contracts';

/** Вид победы для рейтинга (RATING_RULES.md, 3.1). */
export const RATING_WIN_KINDS = ['CLEAN', 'POINTS', 'SMALL_ADVANTAGE', 'MINIMAL_ADVANTAGE'] as const;
export type RatingWinKind = (typeof RATING_WIN_KINDS)[number];

/** Исход схватки для одного спортсмена (RATING_RULES.md, 3). */
export const RATING_OUTCOMES = [
  'CLEAN_WIN',
  'WIN_ON_POINTS',
  'WIN_SMALL_ADVANTAGE',
  'WIN_MINIMAL_ADVANTAGE',
  'LOSS_MINIMAL_ADVANTAGE',
  'LOSS_SMALL_ADVANTAGE',
  'LOSS_ON_POINTS',
  'CLEAN_LOSS',
] as const;
export type RatingOutcome = (typeof RATING_OUTCOMES)[number];

/** K до порога включительно; `maxRating: null` — без верхней границы (последняя строка). */
export interface KFactorRule {
  maxRating: number | null;
  k: number;
}

/** Уровень с порога `from` включительно; `from: null` — нижний уровень. */
export interface LevelRule {
  level: number;
  from: number | null;
}

/**
 * Строка классификатора: способ победы (+ код тай-брейка) → вид победы. `methodDetail` не задан — любой;
 * `null` — пустой. Первая подходящая строка решает.
 */
export interface OutcomeRule {
  method: WinMethod;
  methodDetail?: string | null;
  kind: RatingWinKind;
}

export const ROUNDING_RULES = ['INTEGER_HALF_UP'] as const;
export type RoundingRule = (typeof ROUNDING_RULES)[number];

export interface RatingRules {
  initialRating: number;
  kFactorRules: KFactorRule[];
  /** Фактический результат S спортсмена, десятичной строкой («0.9»). */
  scoreRules: Record<RatingOutcome, string>;
  levelRules: LevelRule[];
  outcomeRules: OutcomeRule[];
  roundingRule: RoundingRule;
}

/** sambo-elo@1: решения заказчика 2026-10-18 (RATING_RULES.md, 8). */
export const SAMBO_ELO_V1: RatingRules = {
  initialRating: 200,
  kFactorRules: [
    { maxRating: 100, k: 60 },
    { maxRating: 300, k: 30 },
    { maxRating: null, k: 10 },
  ],
  scoreRules: {
    CLEAN_WIN: '1',
    WIN_ON_POINTS: '0.9',
    WIN_SMALL_ADVANTAGE: '0.7',
    WIN_MINIMAL_ADVANTAGE: '0.6',
    LOSS_MINIMAL_ADVANTAGE: '0.4',
    LOSS_SMALL_ADVANTAGE: '0.3',
    LOSS_ON_POINTS: '0.1',
    CLEAN_LOSS: '0',
  },
  levelRules: [
    { level: 1, from: null },
    ...Array.from({ length: 9 }, (_, i) => ({ level: i + 2, from: 400 + i * 200 })),
  ],
  outcomeRules: [
    // Ст. 33 п. 1, 38, 39 + решение заказчика: неявка, снятие, травма, дисквалификация — чистая победа соперника.
    { method: 'TOTAL_VICTORY', kind: 'CLEAN' },
    { method: 'SUPERIORITY', kind: 'CLEAN' },
    { method: 'DISQUALIFICATION', kind: 'CLEAN' },
    { method: 'NO_SHOW', kind: 'CLEAN' },
    { method: 'WITHDRAWAL', kind: 'CLEAN' },
    { method: 'INJURY', kind: 'CLEAN' },
    // Ст. 34 п. 1: больше баллов.
    { method: 'POINTS', methodDetail: null, kind: 'POINTS' },
    // Ст. 34 пп. 2–3: при равенстве решило качество приёмов.
    { method: 'POINTS', methodDetail: 'TECHNICAL_POINTS', kind: 'SMALL_ADVANTAGE' },
    { method: 'POINTS', methodDetail: 'MORE_HIGH_SCORES', kind: 'SMALL_ADVANTAGE' },
    // Ст. 34 п. 4, пп. 7–9: последний приём, предупреждения; решение судей.
    { method: 'POINTS', methodDetail: 'LAST_TECHNICAL_ACTION', kind: 'MINIMAL_ADVANTAGE' },
    { method: 'POINTS', methodDetail: 'FEWER_PENALTIES', kind: 'MINIMAL_ADVANTAGE' },
    { method: 'POINTS', methodDetail: 'LAST_PENALTY', kind: 'MINIMAL_ADVANTAGE' },
    { method: 'DECISION', kind: 'MINIMAL_ADVANTAGE' },
  ],
  roundingRule: 'INTEGER_HALF_UP',
};
