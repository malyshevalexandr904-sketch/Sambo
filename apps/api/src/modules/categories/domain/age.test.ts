// Unit: расчёт возраста по трём политикам (IMPLEMENTATION_PLAN, Phase 3): 29 февраля, день рождения
// в день турнира, граница года.
import { describe, expect, it } from 'vitest';
import { birthYearsFor, calculateAge, fullYears } from './age';

describe('fullYears', () => {
  it('counts the birthday itself: on the day of the tournament the athlete is already older', () => {
    expect(fullYears('2012-11-14', '2026-11-13')).toBe(13);
    expect(fullYears('2012-11-14', '2026-11-14')).toBe(14);
    expect(fullYears('2012-11-14', '2026-11-15')).toBe(14);
  });

  it('handles 29 February: reached on 28 February in a common year, on 29 February in a leap year', () => {
    expect(fullYears('2012-02-29', '2026-02-27')).toBe(13);
    expect(fullYears('2012-02-29', '2026-02-28')).toBe(14);
    expect(fullYears('2012-02-29', '2028-02-28')).toBe(15);
    expect(fullYears('2012-02-29', '2028-02-29')).toBe(16);
    expect(fullYears('2012-02-29', '2026-03-01')).toBe(14);
  });

  it('crosses the year boundary', () => {
    expect(fullYears('2012-12-31', '2026-12-30')).toBe(13);
    expect(fullYears('2012-12-31', '2026-12-31')).toBe(14);
    expect(fullYears('2013-01-01', '2026-12-31')).toBe(13);
    expect(fullYears('2013-01-01', '2027-01-01')).toBe(14);
  });
});

describe('calculateAge', () => {
  it('BY_BIRTH_YEAR is the difference of years regardless of the day (Q-03)', () => {
    expect(calculateAge('2012-12-31', '2026-01-01', 'BY_BIRTH_YEAR')).toBe(14);
    expect(calculateAge('2012-01-01', '2026-12-31', 'BY_BIRTH_YEAR')).toBe(14);
    // Регистрация в декабре, турнир в январе: возраст считается по году турнира.
    expect(calculateAge('2012-06-01', '2027-01-10', 'BY_BIRTH_YEAR')).toBe(15);
  });

  it('EXACT_ON_DATE counts full years on the reference date', () => {
    expect(calculateAge('2012-12-31', '2026-01-01', 'EXACT_ON_DATE')).toBe(13);
    expect(calculateAge('2012-02-29', '2026-02-28', 'EXACT_ON_DATE')).toBe(14);
  });

  it('BIRTH_YEAR_RANGE compares years, not age', () => {
    expect(calculateAge('2012-06-01', '2026-01-10', 'BIRTH_YEAR_RANGE')).toBeNull();
  });

  it('maps an age group to birth years of the competition year', () => {
    expect(birthYearsFor(12, 13, 2026)).toEqual({ from: 2013, to: 2014 });
  });
});
