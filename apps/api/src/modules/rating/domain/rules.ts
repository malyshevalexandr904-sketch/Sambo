// Правила расчёта рейтинга (docs/RATING_RULES.md). Версия правил — данные (RatingRuleSet); здесь — первая версия
// «sambo-elo@1» (Приложение 5 + правила вида спорта «самбо», приказ Минспорта № 892).
import type { RatingRuleParametersV1 } from '@sde/contracts';

export {
  RATING_OUTCOMES,
  RATING_WIN_KINDS,
  type RatingOutcome,
  type RatingWinKind,
  ROUNDING_RULES,
  type RoundingRule,
} from '@sde/contracts';

/** Параметры версии правил (RatingRuleSet.parameters), проверенные схемой RatingRuleParametersV1. */
export type RatingRules = RatingRuleParametersV1;
export type OutcomeRule = RatingRules['outcomeRules'][number];

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

/** Версия кода расчёта: меняется при изменении арифметики, входит в calculationVersion расчёта. */
export const RATING_ENGINE_VERSION = 'elo-1';

/** Версия расчёта схватки (RATING_ARCHITECTURE.md, 4): «{code}@{version}/{engineVersion}». */
export const calculationVersion = (ruleSet: {
  code: string;
  version: number;
  engineVersion: string;
}): string => `${ruleSet.code}@${ruleSet.version}/${ruleSet.engineVersion}`;
