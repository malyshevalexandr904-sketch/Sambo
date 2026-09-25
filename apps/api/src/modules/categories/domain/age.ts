// Возраст для категорий (ARCHITECTURE.md, 14.2; решение Q-03). Чистые функции: даты — строки YYYY-MM-DD,
// без часовых поясов (календарные даты турнира и рождения).
import { type AgeCalculationPolicy, fullYearsOn } from '@sde/contracts';

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parse(date: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Полных лет на дату; 29 февраля — по ГК РФ, ст. 192 (реализация — в contracts, общая с UI). */
export const fullYears = (birthDate: string, onDate: string): number => fullYearsOn(birthDate, onDate);

/**
 * Возраст спортсмена для категории:
 * - BY_BIRTH_YEAR — разница годов (возраст «в год соревнований»), по умолчанию (Q-03);
 * - EXACT_ON_DATE — полных лет на дату (дата начала турнира или своя дата категории);
 * - BIRTH_YEAR_RANGE — возраст не считается, сравнивается год рождения (null).
 */
export function calculateAge(
  birthDate: string,
  referenceDate: string,
  policy: AgeCalculationPolicy,
): number | null {
  switch (policy) {
    case 'BY_BIRTH_YEAR':
      return parse(referenceDate).y - parse(birthDate).y;
    case 'EXACT_ON_DATE':
      return fullYears(birthDate, referenceDate);
    case 'BIRTH_YEAR_RANGE':
      return null;
  }
}

export const birthYearOf = (birthDate: string): number => parse(birthDate).y;

/** Годы рождения возрастной группы «по году рождения» для года соревнований: 12–13 лет в 2026 → 2013–2014. */
export function birthYearsFor(
  ageFrom: number,
  ageTo: number,
  competitionYear: number,
): { from: number; to: number } {
  return { from: competitionYear - ageTo, to: competitionYear - ageFrom };
}
