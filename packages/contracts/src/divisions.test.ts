import { describe, expect, it } from 'vitest';
import { DivisionCreate, divisionAge, divisionFor, divisionsOverlap } from './divisions.js';

describe('divisions (docs/RATED_ONLY.md, 4)', () => {
  it('counts age by birth year or in full years', () => {
    expect(divisionAge('2014-12-31', '2026-10-25', 'BY_BIRTH_YEAR')).toBe(12);
    expect(divisionAge('2014-12-31', '2026-10-25', 'EXACT_ON_DATE')).toBe(11);
    expect(divisionAge('2014-10-25', '2026-10-25', 'EXACT_ON_DATE')).toBe(12);
    expect(divisionAge('2014-10-26', '2026-10-25', 'EXACT_ON_DATE')).toBe(11);
  });

  it('finds the division by inclusive bounds; open bounds have no limit', () => {
    const list = [
      { id: 'kids', minAge: null, maxAge: 11 },
      { id: 'youth', minAge: 12, maxAge: 17 },
      { id: 'adults', minAge: 18, maxAge: null },
    ];
    expect(divisionFor(list, 5)?.id).toBe('kids');
    expect(divisionFor(list, 11)?.id).toBe('kids');
    expect(divisionFor(list, 12)?.id).toBe('youth');
    expect(divisionFor(list, 40)?.id).toBe('adults');
    expect(divisionFor(list.slice(1, 2), 30)).toBeNull();
  });

  it('detects overlapping bounds', () => {
    expect(divisionsOverlap({ minAge: 12, maxAge: 15 }, { minAge: 15, maxAge: 17 })).toBe(true);
    expect(divisionsOverlap({ minAge: 12, maxAge: 15 }, { minAge: 16, maxAge: null })).toBe(false);
    expect(divisionsOverlap({ minAge: null, maxAge: null }, { minAge: 40, maxAge: 41 })).toBe(true);
    expect(divisionsOverlap({ minAge: null, maxAge: 9 }, { minAge: 10, maxAge: null })).toBe(false);
  });

  it('rejects an inverted range', () => {
    const r = DivisionCreate.safeParse({ name: 'X', minAge: 20, maxAge: 18 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ['maxAge'], message: 'age_range_invalid' });
  });
});
