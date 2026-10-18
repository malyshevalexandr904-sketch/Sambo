// Рейтинг спортсменов (docs/RATING_RULES.md, docs/RATING_ARCHITECTURE.md): исходы схватки и параметры версии
// правил расчёта (RatingRuleSet.parameters). Расчёт — apps/api/src/modules/rating/domain.
import { z } from 'zod';
import { WIN_METHODS } from './draws.js';

/** Вид победы для рейтинга (RATING_RULES.md, 3.1). */
export const RATING_WIN_KINDS = ['CLEAN', 'POINTS', 'SMALL_ADVANTAGE', 'MINIMAL_ADVANTAGE'] as const;
export type RatingWinKind = (typeof RATING_WIN_KINDS)[number];

/** Исход схватки для одного спортсмена (RATING_RULES.md, 3); зеркальные исходы — на одинаковом расстоянии от краёв. */
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

export const ROUNDING_RULES = ['INTEGER_HALF_UP'] as const;
export type RoundingRule = (typeof ROUNDING_RULES)[number];

export const RATING_RULE_SET_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type RatingRuleSetStatus = (typeof RATING_RULE_SET_STATUSES)[number];

/** FROZEN, SUSPENDED — расчёт схваток спортсмена ждёт (docs/RATING_ARCHITECTURE.md, 6.2). */
export const RATING_STATUSES = ['ACTIVE', 'FROZEN', 'SUSPENDED'] as const;
export type RatingStatus = (typeof RATING_STATUSES)[number];

export const RATING_CALCULATION_STATUSES = [
  'PENDING',
  'COMPLETED',
  'SKIPPED',
  'FAILED',
  'SUPERSEDED',
] as const;
export type RatingCalculationStatus = (typeof RATING_CALCULATION_STATUSES)[number];

const Code = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, { error: 'invalid_code' });
/** S от 0 до 1, не больше 4 знаков после точки. */
const Score = z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, { error: 'invalid_score' });
const scaled = (s: string): number => Math.round(Number(s) * 10_000);

/** Параметры версии правил расчёта рейтинга, schemaVersion 1. */
export const RatingRuleParametersV1 = z.strictObject({
  initialRating: z.number().int().min(1).max(10_000),
  /** K до порога включительно; последняя строка — без порога (`maxRating: null`). */
  kFactorRules: z
    .array(z.strictObject({ maxRating: z.number().int().nullable(), k: z.number().int().min(1).max(1000) }))
    .min(1)
    .refine(
      (rows) =>
        rows.every((r, i) =>
          i === rows.length - 1
            ? r.maxRating === null
            : r.maxRating !== null && (i === 0 || r.maxRating > (rows[i - 1]?.maxRating ?? Infinity)),
        ),
      { error: 'thresholds_not_ascending' },
    ),
  /** S для каждого исхода; зеркальные исходы в сумме дают 1. */
  scoreRules: z
    .strictObject(
      Object.fromEntries(RATING_OUTCOMES.map((o) => [o, Score])) as Record<RatingOutcome, typeof Score>,
    )
    .refine(
      (s) =>
        RATING_OUTCOMES.every(
          (o, i) =>
            scaled(s[o]) + scaled(s[RATING_OUTCOMES[RATING_OUTCOMES.length - 1 - i] as RatingOutcome]) ===
            10_000,
        ),
      { error: 'scores_not_symmetric' },
    ),
  /** Уровень с порога `from` включительно; первый уровень — без порога. */
  levelRules: z
    .array(z.strictObject({ level: z.number().int().min(1).max(100), from: z.number().int().nullable() }))
    .min(1)
    .refine(
      (rows) =>
        rows.every((r, i) => {
          if (i === 0) return r.from === null;
          const prev = rows[i - 1];
          return (
            r.from !== null &&
            prev !== undefined &&
            r.level === prev.level + 1 &&
            (prev.from === null || r.from > prev.from)
          );
        }),
      { error: 'levels_not_ascending' },
    ),
  /** Способ победы (+ код тай-брейка) → вид победы; поле `methodDetail` не задано — любой код, `null` — пустой. */
  outcomeRules: z
    .array(
      z.strictObject({
        method: z.enum(
          WIN_METHODS.filter((m) => m !== 'BYE') as [Exclude<(typeof WIN_METHODS)[number], 'BYE'>],
        ),
        methodDetail: Code.nullable().optional(),
        kind: z.enum(RATING_WIN_KINDS),
      }),
    )
    .min(1),
  roundingRule: z.enum(ROUNDING_RULES),
});
export type RatingRuleParametersV1 = z.infer<typeof RatingRuleParametersV1>;
export const RATING_RULES_SCHEMA_VERSION = 1;
