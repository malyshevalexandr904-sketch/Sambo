// Рейтинг спортсменов (docs/RATING_RULES.md, docs/RATING_ARCHITECTURE.md): исходы схватки и параметры версии
// правил расчёта (RatingRuleSet.parameters). Расчёт — apps/api/src/modules/rating/domain.
import { z } from 'zod';
import { type LocalizedText, PageQuery, Reason, Uuid } from './common.js';
import { COMPETITION_TYPES } from './competitions.js';
import { WIN_METHODS } from './draws.js';
import { GENDERS } from './people.js';

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

/** Корректировка рейтинга: изменённый результат схватки (6.4) или ручная (фаза 14). */
export const RATING_CORRECTION_KINDS = ['RESULT_AMENDED', 'MANUAL'] as const;
export type RatingCorrectionKind = (typeof RATING_CORRECTION_KINDS)[number];

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

// ---- Публичная таблица рейтинга (docs/RATING_ARCHITECTURE.md, 8; фаза 7) ----

/** Публичный идентификатор спортсмена (AthleteProfile.publicId). */
export const AthletePublicId = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/, { error: 'invalid_public_id' });

/**
 * Фильтры таблицы: пол, возраст — полных лет в текущем году (как возрастные группы самбо, по году рождения),
 * регион, клуб. Место в таблице — общее, фильтр только сужает список.
 */
export const RankingsQuery = PageQuery.extend({
  gender: z.enum(GENDERS).optional(),
  ageFrom: z.coerce.number().int().min(0).max(120).optional(),
  ageTo: z.coerce.number().int().min(0).max(120).optional(),
  regionId: Uuid.optional(),
  clubId: Uuid.optional(),
}).refine((q) => q.ageFrom === undefined || q.ageTo === undefined || q.ageFrom <= q.ageTo, {
  error: 'age_range_invalid',
  path: ['ageTo'],
});
export type RankingsQuery = z.infer<typeof RankingsQuery>;

/**
 * Спортсмен на публичных страницах (ADR-15, как табло): «Фамилия И.» и ссылка на карточку — только при действующем
 * общем согласии на распространение ПДн; иначе `name` и `publicId` пусты, `hidden: true`. Клуб и регион — всегда.
 */
export interface PublicRatedAthlete {
  publicId: string | null;
  name: string | null;
  hidden: boolean;
  club: string | null;
  region: LocalizedText | null;
}

export interface PublicRankingRow {
  /** Место в общей таблице; равный рейтинг — одно место. */
  rank: number;
  /** На сколько мест поднялся (+) или опустился (−) с последнего ежедневного снимка; null — снимка ещё нет. */
  rankChange: number | null;
  athlete: PublicRatedAthlete;
  rating: number;
  level: number;
  peakRating: number;
  ratedMatches: number;
  wins: number;
  losses: number;
}

export interface PublicAthleteRating extends PublicRankingRow {
  lowestRating: number;
  lastRatedMatchAt: string | null;
}

export const RatingHistoryQuery = PageQuery;
export type RatingHistoryQuery = z.infer<typeof RatingHistoryQuery>;

/** Точка истории рейтинга (для графика: X — `at`, Y — `ratingAfter`): схватка или корректировка. */
export interface PublicRatingHistoryItem {
  kind: 'MATCH' | 'CORRECTION';
  at: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  levelAfter: number;
  /** Схватка: исход для спортсмена (RatingOutcome); корректировка — null. */
  outcome: RatingOutcome | null;
  competition: { slug: string; name: string } | null;
  opponent: (PublicRatedAthlete & { ratingBefore: number }) | null;
}

// ---- Рейтинг на странице рейтингового турнира (docs/RATING_ARCHITECTURE.md, 8, 9; фаза 13) ----

/**
 * Сторона посчитанной схватки турнира: рейтинг до и после, уровни, исход для спортсмена. Значения — от сервера,
 * фронтенд Elo не считает (ТЗ 71).
 */
export interface PublicRatedMatchSide {
  athlete: PublicRatedAthlete;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  levelBefore: number;
  levelAfter: number;
  outcome: RatingOutcome;
}

/** Посчитанная схватка рейтингового турнира (действующий расчёт), новые сверху. */
export interface PublicRatedMatch {
  matchPublicId: string;
  matchNumber: number | null;
  category: LocalizedText;
  finishedAt: string;
  red: PublicRatedMatchSide;
  blue: PublicRatedMatchSide;
}

export const RatedMatchesQuery = PageQuery;
export type RatedMatchesQuery = z.infer<typeof RatedMatchesQuery>;

/**
 * Изменение рейтинга спортсмена за турнир: рейтинг до первой посчитанной схватки, изменение — сумма изменений
 * действующих расчётов, после — их сумма к рейтингу до.
 */
export interface PublicRatingSummaryRow {
  athlete: PublicRatedAthlete;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  levelBefore: number;
  levelAfter: number;
  matches: number;
  wins: number;
  losses: number;
}

export interface PublicCompetitionRatingSummary {
  /** Версия расчёта турнира (закреплённая версия правил). */
  calculationVersion: string;
  /** Посчитанные схватки турнира. */
  ratedMatches: number;
  /** По изменению за турнир, от большего. */
  athletes: PublicRatingSummaryRow[];
}

// ---- Рейтинговый турнир: включение и смена типа платформой (docs/RATING_ARCHITECTURE.md, 3.1) ----

/**
 * Включение рейтинга у турнира до публикации (`competition.convert_to_rated`): закрепляется версия правил расчёта —
 * указанная или действующая.
 */
export const CompetitionRatingEnable = z.object({
  ruleSetId: Uuid.optional(),
  publicDeltas: z.boolean().default(true),
  reason: Reason,
});
export type CompetitionRatingEnable = z.infer<typeof CompetitionRatingEnable>;

/**
 * Административная смена типа турнира (в том числе опубликованного), пока по турниру нет ни одного расчёта
 * рейтинга. Причина обязательна, действие записывается в аудит.
 */
export const CompetitionTypeChange = z.object({
  competitionType: z.enum(COMPETITION_TYPES),
  ruleSetId: Uuid.optional(),
  publicDeltas: z.boolean().default(true),
  reason: Reason,
});
export type CompetitionTypeChange = z.infer<typeof CompetitionTypeChange>;

/** Версия правил расчёта для экрана создания рейтингового турнира (только чтение). */
export interface RatingRuleSetSummary {
  id: string;
  code: string;
  version: number;
  name: string;
  calculationVersion: string;
  activeFrom: string | null;
  rules: Pick<
    RatingRuleParametersV1,
    'initialRating' | 'kFactorRules' | 'scoreRules' | 'levelRules' | 'roundingRule'
  >;
}
