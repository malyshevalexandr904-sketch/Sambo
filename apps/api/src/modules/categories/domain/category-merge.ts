// Объединение категорий (D-03): до жеребьёвки, только одного пола. Границы целевой категории расширяются
// до объединения границ, чтобы взвешивание и совместимость принимали всех перенесённых участников.
import type { AgeCalculationPolicy, CategoryWeight, Gender } from '@sde/contracts';
import { categoryWeightLabel } from '@sde/contracts';

export interface MergeBounds {
  gender: Gender;
  agePolicy: AgeCalculationPolicy;
  ageFrom: number | null;
  ageTo: number | null;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  weight: CategoryWeight;
}

const MIN_GRAMS = 10_000;

const minOf = (values: (number | null)[]): number | null =>
  values.includes(null) ? null : Math.min(...(values as number[]));
const maxOf = (values: (number | null)[]): number | null =>
  values.includes(null) ? null : Math.max(...(values as number[]));

export type MergeIssue = 'gender_mismatch' | 'age_policy_mismatch';

export function mergeIssues(target: MergeBounds, sources: readonly MergeBounds[]): MergeIssue[] {
  const issues = new Set<MergeIssue>();
  for (const s of sources) {
    if (s.gender !== target.gender) issues.add('gender_mismatch');
    if (s.agePolicy !== target.agePolicy) issues.add('age_policy_mismatch');
  }
  return [...issues];
}

/** Объединение границ: возраст и годы рождения — от минимума до максимума; вес — от самой лёгкой до самой тяжёлой. */
export function mergedBounds(target: MergeBounds, sources: readonly MergeBounds[]): MergeBounds {
  const all = [target, ...sources];
  const above = all.some((b) => b.weight.kind === 'ABOVE');
  const lower = minOf(all.map((b) => b.weight.lowerGrams));
  const upper = above ? null : maxOf(all.map((b) => b.weight.upperGrams));
  return {
    gender: target.gender,
    agePolicy: target.agePolicy,
    ageFrom: minOf(all.map((b) => b.ageFrom)),
    ageTo: maxOf(all.map((b) => b.ageTo)),
    birthYearFrom: minOf(all.map((b) => b.birthYearFrom)),
    birthYearTo: maxOf(all.map((b) => b.birthYearTo)),
    // «Свыше» без нижней границы не бывает: объединение всех весов — «свыше 10 кг» (минимум Grams).
    weight: above
      ? { kind: 'ABOVE', lowerGrams: lower ?? MIN_GRAMS, upperGrams: null }
      : { kind: 'UP_TO', lowerGrams: lower, upperGrams: upper },
  };
}

/**
 * Название целевой категории после объединения: подпись веса в конце названия («…, до 35 кг») заменяется на
 * новую. Название, введённое вручную без подписи веса, не меняется.
 */
export function renameForWeight(
  name: string,
  before: CategoryWeight,
  after: CategoryWeight,
  locale: 'ru' | 'en',
): string {
  const old = categoryWeightLabel(before, locale);
  return name.endsWith(old) ? `${name.slice(0, -old.length)}${categoryWeightLabel(after, locale)}` : name;
}
