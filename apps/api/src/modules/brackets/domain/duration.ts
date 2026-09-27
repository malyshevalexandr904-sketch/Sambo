// Длительность схватки — снимок из закреплённой версии правил при создании схватки (DATABASE.md, 3.6).
// Категория с несколькими возрастами получает длительность самого младшего возраста (безопасность детей);
// утешительные схватки — repechageMatchSeconds, если он задан.
import type { AgeCalculationPolicy, RuleSetParametersV1 } from '@sde/contracts';

export interface CategoryAgeSpan {
  policy: AgeCalculationPolicy;
  ageFrom: number | null;
  birthYearTo: number | null;
  /** Год, на который считается возраст: дата возраста категории или дата начала турнира. */
  referenceYear: number;
}

export function youngestAge(c: CategoryAgeSpan): number | null {
  if (c.policy === 'BIRTH_YEAR_RANGE') return c.birthYearTo === null ? null : c.referenceYear - c.birthYearTo;
  return c.ageFrom;
}

export function matchDurationSeconds(
  params: Pick<RuleSetParametersV1, 'matchDuration' | 'repechageMatchSeconds'>,
  age: number | null,
  repechage: boolean,
): number | null {
  if (repechage && params.repechageMatchSeconds !== undefined) return params.repechageMatchSeconds;
  if (age === null) return null;
  return params.matchDuration.find((r) => age >= r.ageFrom && age <= r.ageTo)?.seconds ?? null;
}
