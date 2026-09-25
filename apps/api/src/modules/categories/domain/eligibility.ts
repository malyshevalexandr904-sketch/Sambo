// Совместимость спортсмена с категориями (ARCHITECTURE.md, 14.2; ADR-02). Единственное место расчёта:
// UI получает готовый результат (eligible-categories, Phase 4) и сам совместимость не вычисляет.
import type {
  AgeCalculationPolicy,
  CategoryRuleKind,
  EligibilityReason,
  Gender,
  WeightLimitKind,
} from '@sde/contracts';
import { birthYearOf, calculateAge } from './age';

export interface WeightBounds {
  kind: WeightLimitKind;
  /** Нижняя граница, не включительно; для «свыше» — обязательна. */
  lowerGrams: number | null;
  /** Верхняя граница, включительно; для «свыше» — нет. */
  upperGrams: number | null;
}

export interface AgeBounds {
  policy: AgeCalculationPolicy;
  ageFrom: number | null;
  ageTo: number | null;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  /** Своя дата расчёта возраста категории; иначе — дата начала турнира. */
  referenceDate: string | null;
}

export interface CategorySpec {
  id: string;
  gender: Gender;
  age: AgeBounds;
  weight: WeightBounds;
}

export interface CategoryRuleSpec {
  kind: CategoryRuleKind;
  /** null — правило на весь турнир. */
  categoryId: string | null;
  params: Record<string, unknown>;
}

export interface AthleteSnapshot {
  birthDate: string;
  gender: Gender;
  rankCode: string | null;
  regionId: string | null;
  declaredWeightGrams: number | null;
}

export interface EligibilityContext {
  /** Дата начала турнира (YYYY-MM-DD). */
  competitionStartDate: string;
  /** Порядок разрядов ЕВСК: код → rankOrder. */
  rankOrder: ReadonlyMap<string, number>;
  /** Сколько действующих участий у спортсмена в турнире уже есть. */
  existingEntries: number;
}

export interface EligibleCategory<C extends CategorySpec> {
  category: C;
  /** Заявленный вес в границах категории; null — вес не заявлен. Только подсказка: решает взвешивание. */
  weightMatch: boolean | null;
}

export interface EligibilityResult<C extends CategorySpec> {
  eligible: EligibleCategory<C>[];
  ineligible: { category: C; reasons: EligibilityReason[] }[];
}

/** Вес в категории: lower < вес ≤ upper + допуск; для «свыше» — только нижняя граница (ARCHITECTURE.md, 14.3). */
export function weightFits(weightGrams: number, bounds: WeightBounds, toleranceGrams = 0): boolean {
  if (bounds.kind === 'ABOVE') return bounds.lowerGrams !== null && weightGrams > bounds.lowerGrams;
  if (bounds.lowerGrams !== null && weightGrams <= bounds.lowerGrams) return false;
  return bounds.upperGrams === null || weightGrams <= bounds.upperGrams + toleranceGrams;
}

/**
 * Границы весовых категорий одного пола из пределов шаблона: «до 35», «до 38», «свыше 38» →
 * (—, 35], (35, 38], (38, —). Нижняя граница «до N» — предыдущий предел.
 */
export function weightBounds(limits: { kind: WeightLimitKind; limitGrams: number }[]): WeightBounds[] {
  const upTo = limits.filter((l) => l.kind === 'UP_TO').sort((a, b) => a.limitGrams - b.limitGrams);
  const result = new Map<{ kind: WeightLimitKind; limitGrams: number }, WeightBounds>();
  upTo.forEach((l, i) =>
    result.set(l, { kind: 'UP_TO', lowerGrams: upTo[i - 1]?.limitGrams ?? null, upperGrams: l.limitGrams }),
  );
  for (const l of limits.filter((x) => x.kind === 'ABOVE'))
    result.set(l, { kind: 'ABOVE', lowerGrams: l.limitGrams, upperGrams: null });
  return limits.map((l) => result.get(l) as WeightBounds);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rulesFor(rules: CategoryRuleSpec[], categoryId: string, kind: CategoryRuleKind): CategoryRuleSpec[] {
  return rules.filter((r) => r.kind === kind && (r.categoryId === null || r.categoryId === categoryId));
}

function ageReasons(
  athlete: AthleteSnapshot,
  c: CategorySpec,
  ctx: EligibilityContext,
  youngerYears: number,
): EligibilityReason[] {
  const age = c.age;
  if (age.policy === 'BIRTH_YEAR_RANGE') {
    const year = birthYearOf(athlete.birthDate);
    // Младший спортсмен родился позже: допуск младших расширяет верхнюю границу года рождения.
    const tooOld = age.birthYearFrom !== null && year < age.birthYearFrom;
    const tooYoung = age.birthYearTo !== null && year > age.birthYearTo + youngerYears;
    return tooOld || tooYoung ? ['BIRTH_YEAR_OUT_OF_RANGE'] : [];
  }
  const value = calculateAge(athlete.birthDate, age.referenceDate ?? ctx.competitionStartDate, age.policy);
  if (value === null) return [];
  const reasons: EligibilityReason[] = [];
  if (age.ageFrom !== null && value < age.ageFrom - youngerYears) reasons.push('AGE_BELOW_MIN');
  if (age.ageTo !== null && value > age.ageTo) reasons.push('AGE_ABOVE_MAX');
  return reasons;
}

function rankReasons(
  athlete: AthleteSnapshot,
  c: CategorySpec,
  rules: CategoryRuleSpec[],
  ctx: EligibilityContext,
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const own = athlete.rankCode ? (ctx.rankOrder.get(athlete.rankCode) ?? null) : null;
  for (const r of rulesFor(rules, c.id, 'MIN_RANK')) {
    const min = ctx.rankOrder.get(String(r.params.sportRankCode));
    if (min === undefined) continue;
    if (own === null) reasons.push('RANK_REQUIRED');
    else if (own < min) reasons.push('RANK_TOO_LOW');
  }
  for (const r of rulesFor(rules, c.id, 'MAX_RANK')) {
    const max = ctx.rankOrder.get(String(r.params.sportRankCode));
    if (max !== undefined && own !== null && own > max) reasons.push('RANK_TOO_HIGH');
  }
  return reasons;
}

/**
 * Совместимые и несовместимые категории с причинами. Проверяются пол, возраст (или год рождения)
 * с учётом допуска младших, разряд, регион и лимит категорий на спортсмена. Заявленный вес не исключает
 * категорию — он только отмечает подходящие (weightMatch).
 */
export function resolveEligibleCategories<C extends CategorySpec>(
  athlete: AthleteSnapshot,
  categories: readonly C[],
  rules: readonly CategoryRuleSpec[],
  ctx: EligibilityContext,
): EligibilityResult<C> {
  const all = [...rules];
  const result: EligibilityResult<C> = { eligible: [], ineligible: [] };
  for (const c of categories) {
    const reasons: EligibilityReason[] = [];
    if (c.gender !== athlete.gender) reasons.push('GENDER_MISMATCH');
    const younger = Math.max(0, ...rulesFor(all, c.id, 'ALLOW_YOUNGER').map((r) => num(r.params.years) ?? 0));
    reasons.push(...ageReasons(athlete, c, ctx, younger), ...rankReasons(athlete, c, all, ctx));
    for (const r of rulesFor(all, c.id, 'REGION_ONLY')) {
      const allowed = Array.isArray(r.params.regionIds) ? (r.params.regionIds as unknown[]) : [];
      if (!athlete.regionId || !allowed.includes(athlete.regionId)) reasons.push('REGION_NOT_ALLOWED');
    }
    for (const r of rulesFor(all, c.id, 'MAX_CATEGORIES_PER_ATHLETE')) {
      const max = num(r.params.max);
      if (max !== null && ctx.existingEntries >= max) reasons.push('MAX_CATEGORIES_REACHED');
    }
    const unique = [...new Set(reasons)];
    if (unique.length > 0) {
      result.ineligible.push({ category: c, reasons: unique });
    } else {
      const w = athlete.declaredWeightGrams;
      result.eligible.push({ category: c, weightMatch: w === null ? null : weightFits(w, c.weight) });
    }
  }
  return result;
}
