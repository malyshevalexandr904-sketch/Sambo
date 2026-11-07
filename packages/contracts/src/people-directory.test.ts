// Справочник людей платформы (правки 07.11.2026): стаж и рейтинг судьи.
import { describe, expect, it } from 'vitest';
import { averageStars, experienceYears, RefereeRatingPut } from './people-directory.js';

describe('referee stats', () => {
  it('experience counts full calendar years since the first year of refereeing', () => {
    expect(experienceYears(null, '2026-11-07')).toBeNull();
    expect(experienceYears(2015, '2026-11-07')).toBe(11);
    expect(experienceYears(2026, '2026-11-07')).toBe(0);
  });

  it('the rating is the mean of 1–5 stars to one decimal', () => {
    expect(averageStars([])).toBeNull();
    expect(averageStars([5, 4, 4])).toBe(4.3);
    expect(RefereeRatingPut.safeParse({ stars: 6 }).success).toBe(false);
    expect(RefereeRatingPut.safeParse({ stars: 0 }).success).toBe(false);
  });
});
