import { describe, expect, it } from 'vitest';
import { ageLabel, generateCategories, type TemplateItem } from './category-generation';
import { findCategoryTransition, initialCategoryStatus, manualTransitionsFrom } from './category-machine';
import { type MergeBounds, mergedBounds, mergeIssues, renameForWeight } from './category-merge';

const group = {
  id: 'ag',
  code: 'Y12_14',
  nameRu: '12–13 лет',
  nameEn: '12–13',
  policy: 'BY_BIRTH_YEAR' as const,
  ageFrom: 12,
  ageTo: 13,
};
const item = (gender: 'MALE' | 'FEMALE', kind: 'UP_TO' | 'ABOVE', limitGrams: number): TemplateItem => ({
  ageGroup: group,
  gender,
  weight: { kind, limitGrams },
});

describe('category state machine (C-03)', () => {
  it('manual transitions exclude draw, bouts and results; merge has its own command', () => {
    expect(manualTransitionsFrom('REGISTRATION')).toEqual(['CLOSED', 'CANCELLED']);
    expect(manualTransitionsFrom('READY_FOR_DRAW')).toEqual(['CANCELLED']);
    expect(findCategoryTransition('READY_FOR_DRAW', 'DRAWN')?.manual).toBe(false);
    expect(findCategoryTransition('CLOSED', 'MERGED')?.manual).toBe(false);
    expect(findCategoryTransition('CLOSED', 'REGISTRATION')).toMatchObject({
      reasonRequired: true,
      competition: ['REGISTRATION_OPEN'],
    });
    expect(findCategoryTransition('DRAWN', 'CANCELLED')).toBeNull();
  });

  it('a category created after registration closed is closed from the start', () => {
    expect(initialCategoryStatus('REGISTRATION_OPEN')).toBe('REGISTRATION');
    expect(initialCategoryStatus('REGISTRATION_CLOSED')).toBe('CLOSED');
  });
});

describe('categories from a template', () => {
  it('turns weight limits into bounds per age group and gender; birth years for the competition year', () => {
    const result = generateCategories(
      [
        item('FEMALE', 'UP_TO', 34000),
        item('MALE', 'ABOVE', 38000),
        item('MALE', 'UP_TO', 38000),
        item('MALE', 'UP_TO', 35000),
        item('MALE', 'UP_TO', 38500),
      ],
      '2026-11-14',
    );
    expect(result.map((c) => c.code)).toEqual([
      'M-Y12_14-35',
      'M-Y12_14-38',
      'M-Y12_14-38_5',
      'M-Y12_14-38+',
      'F-Y12_14-34',
    ]);
    expect(result.map((c) => c.weight)).toEqual([
      { kind: 'UP_TO', lowerGrams: null, upperGrams: 35000 },
      { kind: 'UP_TO', lowerGrams: 35000, upperGrams: 38000 },
      { kind: 'UP_TO', lowerGrams: 38000, upperGrams: 38500 },
      { kind: 'ABOVE', lowerGrams: 38000, upperGrams: null },
      { kind: 'UP_TO', lowerGrams: null, upperGrams: 34000 },
    ]);
    expect(result[2]?.nameRu).toBe('Юноши 12–13 лет, до 38,5 кг');
    expect(result[3]?.nameEn).toBe('Boys 12–13, over 38 kg');
    expect([ageLabel(18, 21, 'ru'), ageLabel(20, 22, 'ru'), ageLabel(16, 16, 'ru')]).toEqual([
      '18–21 год',
      '20–22 года',
      '16 лет',
    ]);
    expect(result[0]).toMatchObject({ birthYearFrom: 2013, birthYearTo: 2014, agePolicy: 'BY_BIRTH_YEAR' });
    expect(new Set(result.map((c) => c.sortOrder)).size).toBe(result.length);
  });

  it('exact age groups keep ages without birth years', () => {
    const [c] = generateCategories(
      [{ ...item('MALE', 'UP_TO', 40000), ageGroup: { ...group, policy: 'EXACT_ON_DATE' } }],
      '2026-11-14',
    );
    expect(c).toMatchObject({
      agePolicy: 'EXACT_ON_DATE',
      ageFrom: 12,
      ageTo: 13,
      birthYearFrom: null,
      birthYearTo: null,
    });
  });
});

describe('merging categories (D-03)', () => {
  const b = (weight: MergeBounds['weight'], over: Partial<MergeBounds> = {}): MergeBounds => ({
    gender: 'MALE',
    agePolicy: 'BY_BIRTH_YEAR',
    ageFrom: 12,
    ageTo: 13,
    birthYearFrom: 2013,
    birthYearTo: 2014,
    weight,
    ...over,
  });

  it('refuses different genders and age policies', () => {
    expect(
      mergeIssues(b({ kind: 'UP_TO', lowerGrams: null, upperGrams: 35000 }), [
        b({ kind: 'UP_TO', lowerGrams: null, upperGrams: 34000 }, { gender: 'FEMALE' }),
      ]),
    ).toEqual(['gender_mismatch']);
    expect(
      mergeIssues(b({ kind: 'UP_TO', lowerGrams: null, upperGrams: 35000 }), [
        b({ kind: 'UP_TO', lowerGrams: null, upperGrams: 34000 }, { agePolicy: 'EXACT_ON_DATE' }),
      ]),
    ).toEqual(['age_policy_mismatch']);
  });

  it('widens the target to the union of bounds', () => {
    const light = b({ kind: 'UP_TO', lowerGrams: null, upperGrams: 35000 });
    const middle = b({ kind: 'UP_TO', lowerGrams: 35000, upperGrams: 38000 }, { ageFrom: 12, ageTo: 13 });
    const heavy = b(
      { kind: 'ABOVE', lowerGrams: 38000, upperGrams: null },
      { ageFrom: 14, ageTo: 15, birthYearFrom: 2011, birthYearTo: 2012 },
    );
    expect(mergedBounds(middle, [light]).weight).toEqual({
      kind: 'UP_TO',
      lowerGrams: null,
      upperGrams: 38000,
    });
    expect(mergedBounds(middle, [heavy])).toMatchObject({
      weight: { kind: 'ABOVE', lowerGrams: 35000, upperGrams: null },
      ageFrom: 12,
      ageTo: 15,
      birthYearFrom: 2011,
      birthYearTo: 2014,
    });
    expect(mergedBounds(light, [heavy]).weight).toEqual({
      kind: 'ABOVE',
      lowerGrams: 10000,
      upperGrams: null,
    });
  });

  it('renames only the weight label at the end of a generated name', () => {
    const before = { kind: 'UP_TO' as const, lowerGrams: null, upperGrams: 35000 };
    const after = { kind: 'UP_TO' as const, lowerGrams: null, upperGrams: 38000 };
    expect(renameForWeight('Юноши 12–13 лет, до 35 кг', before, after, 'ru')).toBe(
      'Юноши 12–13 лет, до 38 кг',
    );
    expect(renameForWeight('Абсолютная', before, after, 'ru')).toBe('Абсолютная');
  });
});
