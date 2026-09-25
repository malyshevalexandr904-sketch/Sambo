// Unit: определение категории (IMPLEMENTATION_PLAN, Phase 3): пол, возраст, вес на границе, «свыше»,
// квалификация, допуск младших, регион, лимит категорий.
import { describe, expect, it } from 'vitest';
import {
  type AthleteSnapshot,
  type CategoryRuleSpec,
  type CategorySpec,
  type EligibilityContext,
  resolveEligibleCategories,
  weightBounds,
  weightFits,
} from './eligibility';

const byYear = (ageFrom: number, ageTo: number) => ({
  policy: 'BY_BIRTH_YEAR' as const,
  ageFrom,
  ageTo,
  birthYearFrom: null,
  birthYearTo: null,
  referenceDate: null,
});

const cat = (id: string, over: Partial<CategorySpec> = {}): CategorySpec => ({
  id,
  gender: 'MALE',
  age: byYear(12, 13),
  weight: { kind: 'UP_TO', lowerGrams: 35_000, upperGrams: 38_000 },
  ...over,
});

const athlete = (over: Partial<AthleteSnapshot> = {}): AthleteSnapshot => ({
  birthDate: '2013-05-10',
  gender: 'MALE',
  rankCode: 'YOUTH_1',
  regionId: 'region-a',
  declaredWeightGrams: null,
  ...over,
});

const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  competitionStartDate: '2026-11-14',
  rankOrder: new Map([
    ['YOUTH_3', 1],
    ['YOUTH_2', 2],
    ['YOUTH_1', 3],
    ['SPORT_3', 4],
    ['SPORT_2', 5],
  ]),
  existingEntries: 0,
  ...over,
});

const reasonsOf = (a: AthleteSnapshot, c: CategorySpec, rules: CategoryRuleSpec[] = [], x = ctx()) => {
  const r = resolveEligibleCategories(a, [c], rules, x);
  return r.ineligible[0]?.reasons ?? [];
};

describe('weightFits', () => {
  const upTo38 = { kind: 'UP_TO' as const, lowerGrams: 35_000, upperGrams: 38_000 };

  it('upper bound is inclusive, lower is exclusive', () => {
    expect(weightFits(38_000, upTo38)).toBe(true);
    expect(weightFits(38_001, upTo38)).toBe(false);
    expect(weightFits(35_000, upTo38)).toBe(false);
    expect(weightFits(35_001, upTo38)).toBe(true);
  });

  it('tolerance extends only the upper bound', () => {
    expect(weightFits(38_200, upTo38, 200)).toBe(true);
    expect(weightFits(38_201, upTo38, 200)).toBe(false);
  });

  it('"above" has no upper bound and excludes the limit itself', () => {
    const above72 = { kind: 'ABOVE' as const, lowerGrams: 72_000, upperGrams: null };
    expect(weightFits(72_000, above72)).toBe(false);
    expect(weightFits(72_001, above72)).toBe(true);
    expect(weightFits(140_000, above72)).toBe(true);
  });

  it('the lightest category has no lower bound', () => {
    expect(weightFits(20_000, { kind: 'UP_TO', lowerGrams: null, upperGrams: 30_000 })).toBe(true);
  });

  it('derives bounds from template limits', () => {
    expect(
      weightBounds([
        { kind: 'UP_TO', limitGrams: 38_000 },
        { kind: 'ABOVE', limitGrams: 42_000 },
        { kind: 'UP_TO', limitGrams: 35_000 },
        { kind: 'UP_TO', limitGrams: 42_000 },
      ]),
    ).toEqual([
      { kind: 'UP_TO', lowerGrams: 35_000, upperGrams: 38_000 },
      { kind: 'ABOVE', lowerGrams: 42_000, upperGrams: null },
      { kind: 'UP_TO', lowerGrams: null, upperGrams: 35_000 },
      { kind: 'UP_TO', lowerGrams: 38_000, upperGrams: 42_000 },
    ]);
  });
});

describe('resolveEligibleCategories', () => {
  it('filters by gender', () => {
    expect(reasonsOf(athlete({ gender: 'FEMALE' }), cat('c1'))).toEqual(['GENDER_MISMATCH']);
  });

  it('checks the age by birth year at the competition year', () => {
    expect(reasonsOf(athlete({ birthDate: '2013-12-31' }), cat('c1'))).toEqual([]);
    expect(reasonsOf(athlete({ birthDate: '2015-01-01' }), cat('c1'))).toEqual(['AGE_BELOW_MIN']);
    expect(reasonsOf(athlete({ birthDate: '2012-01-01' }), cat('c1'))).toEqual(['AGE_ABOVE_MAX']);
  });

  it('checks the exact age on the category reference date, including a birthday on that day', () => {
    const exact = cat('c1', {
      age: { ...byYear(13, 13), policy: 'EXACT_ON_DATE', referenceDate: '2026-11-14' },
    });
    expect(reasonsOf(athlete({ birthDate: '2013-11-14' }), exact)).toEqual([]);
    expect(reasonsOf(athlete({ birthDate: '2013-11-15' }), exact)).toEqual(['AGE_BELOW_MIN']);
    expect(reasonsOf(athlete({ birthDate: '2012-11-14' }), exact)).toEqual(['AGE_ABOVE_MAX']);
  });

  it('checks the birth year range and lets younger athletes in when allowed', () => {
    const range = cat('c1', {
      age: {
        policy: 'BIRTH_YEAR_RANGE',
        ageFrom: null,
        ageTo: null,
        birthYearFrom: 2012,
        birthYearTo: 2013,
        referenceDate: null,
      },
    });
    expect(reasonsOf(athlete({ birthDate: '2014-01-01' }), range)).toEqual(['BIRTH_YEAR_OUT_OF_RANGE']);
    expect(reasonsOf(athlete({ birthDate: '2011-12-31' }), range)).toEqual(['BIRTH_YEAR_OUT_OF_RANGE']);
    const younger: CategoryRuleSpec = { kind: 'ALLOW_YOUNGER', categoryId: 'c1', params: { years: 1 } };
    expect(reasonsOf(athlete({ birthDate: '2014-01-01' }), range, [younger])).toEqual([]);
    expect(reasonsOf(athlete({ birthDate: '2015-01-01' }), range, [younger])).toEqual([
      'BIRTH_YEAR_OUT_OF_RANGE',
    ]);
  });

  it('allows younger athletes by age only for the category the rule names', () => {
    const young = athlete({ birthDate: '2015-03-01' });
    const rule: CategoryRuleSpec = { kind: 'ALLOW_YOUNGER', categoryId: 'c1', params: { years: 1 } };
    expect(reasonsOf(young, cat('c1'), [rule])).toEqual([]);
    expect(reasonsOf(young, cat('c2'), [rule])).toEqual(['AGE_BELOW_MIN']);
    // Старшим допуск младших не помогает.
    expect(reasonsOf(athlete({ birthDate: '2012-03-01' }), cat('c1'), [rule])).toEqual(['AGE_ABOVE_MAX']);
  });

  it('checks the qualification (sports rank)', () => {
    const min: CategoryRuleSpec = {
      kind: 'MIN_RANK',
      categoryId: null,
      params: { sportRankCode: 'SPORT_3' },
    };
    const max: CategoryRuleSpec = {
      kind: 'MAX_RANK',
      categoryId: null,
      params: { sportRankCode: 'YOUTH_2' },
    };
    expect(reasonsOf(athlete({ rankCode: 'YOUTH_1' }), cat('c1'), [min])).toEqual(['RANK_TOO_LOW']);
    expect(reasonsOf(athlete({ rankCode: null }), cat('c1'), [min])).toEqual(['RANK_REQUIRED']);
    expect(reasonsOf(athlete({ rankCode: 'SPORT_2' }), cat('c1'), [min])).toEqual([]);
    expect(reasonsOf(athlete({ rankCode: 'YOUTH_1' }), cat('c1'), [max])).toEqual(['RANK_TOO_HIGH']);
    expect(reasonsOf(athlete({ rankCode: null }), cat('c1'), [max])).toEqual([]);
  });

  it('checks region and the limit of categories per athlete', () => {
    const region: CategoryRuleSpec = {
      kind: 'REGION_ONLY',
      categoryId: null,
      params: { regionIds: ['region-b'] },
    };
    expect(reasonsOf(athlete(), cat('c1'), [region])).toEqual(['REGION_NOT_ALLOWED']);
    const limit: CategoryRuleSpec = {
      kind: 'MAX_CATEGORIES_PER_ATHLETE',
      categoryId: null,
      params: { max: 1 },
    };
    expect(reasonsOf(athlete(), cat('c1'), [limit], ctx({ existingEntries: 1 }))).toEqual([
      'MAX_CATEGORIES_REACHED',
    ]);
    expect(reasonsOf(athlete(), cat('c1'), [limit], ctx({ existingEntries: 0 }))).toEqual([]);
  });

  it('declared weight only marks matching categories and never excludes one', () => {
    const categories = [
      cat('c35', { weight: { kind: 'UP_TO', lowerGrams: null, upperGrams: 35_000 } }),
      cat('c38', { weight: { kind: 'UP_TO', lowerGrams: 35_000, upperGrams: 38_000 } }),
      cat('c38plus', { weight: { kind: 'ABOVE', lowerGrams: 38_000, upperGrams: null } }),
    ];
    const res = resolveEligibleCategories(athlete({ declaredWeightGrams: 38_000 }), categories, [], ctx());
    expect(res.ineligible).toEqual([]);
    expect(res.eligible.map((e) => [e.category.id, e.weightMatch])).toEqual([
      ['c35', false],
      ['c38', true],
      ['c38plus', false],
    ]);
    const noWeight = resolveEligibleCategories(athlete(), categories, [], ctx());
    expect(noWeight.eligible.every((e) => e.weightMatch === null)).toBe(true);
  });

  it('collects every reason at once', () => {
    const min: CategoryRuleSpec = {
      kind: 'MIN_RANK',
      categoryId: null,
      params: { sportRankCode: 'SPORT_2' },
    };
    expect(reasonsOf(athlete({ gender: 'FEMALE', birthDate: '2016-01-01' }), cat('c1'), [min])).toEqual([
      'GENDER_MISMATCH',
      'AGE_BELOW_MIN',
      'RANK_TOO_LOW',
    ]);
  });
});
