// Схемы Phase 3: параметры правил, нормализация строк импорта, публичное имя, возраст спортсмена.
import { describe, expect, it } from 'vitest';
import { normalizeImportDate, normalizeImportRow, importColumnFor } from './imports.js';
import { athleteBirthDateInRange, fullName, publicName } from './people.js';
import { canonicalJson, RuleSetParametersV1, SAMPLE_RULESET_PARAMETERS } from './rulesets.js';
import { weightLabelKg } from './categories.js';
import { AthleteCreate } from './athletes.js';

describe('RuleSetParametersV1', () => {
  it('accepts the documented sample', () => {
    expect(RuleSetParametersV1.safeParse(SAMPLE_RULESET_PARAMETERS).success).toBe(true);
  });

  it('rejects overlapping age ranges, gaps in format selection and unknown keys', () => {
    const overlap = {
      ...SAMPLE_RULESET_PARAMETERS,
      matchDuration: [
        { ageFrom: 11, ageTo: 14, seconds: 180 },
        { ageFrom: 14, ageTo: 17, seconds: 240 },
      ],
    };
    expect(RuleSetParametersV1.safeParse(overlap).success).toBe(false);
    const gap = {
      ...SAMPLE_RULESET_PARAMETERS,
      formatSelection: [
        { minParticipants: 2, maxParticipants: 5, format: 'ROUND_ROBIN' },
        { minParticipants: 7, maxParticipants: null, format: 'SINGLE_ELIMINATION' },
      ],
    };
    expect(RuleSetParametersV1.safeParse(gap).success).toBe(false);
    const openEnded = {
      ...SAMPLE_RULESET_PARAMETERS,
      formatSelection: [{ minParticipants: 2, maxParticipants: 8, format: 'ROUND_ROBIN' }],
    };
    expect(RuleSetParametersV1.safeParse(openEnded).success).toBe(false);
    expect(RuleSetParametersV1.safeParse({ ...SAMPLE_RULESET_PARAMETERS, extra: 1 }).success).toBe(false);
  });

  it('requires either points or a victory kind for each action, and unique codes', () => {
    const both = {
      ...SAMPLE_RULESET_PARAMETERS,
      actions: [{ code: 'X1', points: 2, kind: 'TOTAL_VICTORY' }],
    };
    expect(RuleSetParametersV1.safeParse(both).success).toBe(false);
    const dup = {
      ...SAMPLE_RULESET_PARAMETERS,
      actions: [
        { code: 'X1', points: 2 },
        { code: 'X1', points: 4 },
      ],
    };
    expect(RuleSetParametersV1.safeParse(dup).success).toBe(false);
  });

  it('canonical JSON does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe('import rows', () => {
  it('maps Russian headers and ignores case, ё and BOM', () => {
    expect(importColumnFor('﻿Фамилия')).toBe('lastName');
    expect(importColumnFor('Дата  рождения')).toBe('birthDate');
    expect(importColumnFor('Email тренера')).toBe('coachEmail');
    expect(importColumnFor('birthDate')).toBe('birthDate');
    expect(importColumnFor('Рост')).toBeNull();
  });

  it('parses ISO and Russian dates and rejects impossible ones', () => {
    expect(normalizeImportDate('2012-05-07')).toBe('2012-05-07');
    expect(normalizeImportDate('7.5.2012')).toBe('2012-05-07');
    expect(normalizeImportDate('07/05/2012')).toBe('2012-05-07');
    expect(normalizeImportDate('31.02.2012')).toBeNull();
    expect(normalizeImportDate('2012.05.07')).toBeNull();
  });

  it('normalizes a valid row and reports field errors for a broken one', () => {
    const ok = normalizeImportRow({
      lastName: ' Иванов ',
      firstName: 'Пётр',
      birthDate: '17.05.2013',
      gender: 'м',
      sportRankCode: 'youth_1',
      rankAssignedAt: '2025-03-01',
      coachEmail: 'Coach@Club.Local',
    });
    expect(ok.errors).toEqual([]);
    expect(ok.data).toEqual({
      lastName: 'Иванов',
      firstName: 'Пётр',
      birthDate: '2013-05-17',
      gender: 'MALE',
      sportRankCode: 'YOUTH_1',
      rankAssignedAt: '2025-03-01',
      coachEmail: 'coach@club.local',
    });
    const bad = normalizeImportRow({
      lastName: 'Иванов2',
      birthDate: '1990-01-01',
      gender: 'x',
      sportRankCode: 'SPORT_1',
    });
    expect(bad.data).toBeNull();
    expect(bad.errors.map((e) => `${e.path}:${e.code}`).sort()).toEqual([
      'birthDate:birth_date_out_of_range',
      'firstName:required',
      'gender:invalid_gender',
      'lastName:invalid_name',
      'rankAssignedAt:required',
    ]);
  });
});

describe('people helpers', () => {
  it('builds the public name of Q-04 and the full name', () => {
    expect(publicName('Иванов', 'пётр')).toBe('Иванов П.');
    expect(fullName({ lastName: 'Иванов', firstName: 'Пётр', middleName: null })).toBe('Иванов Пётр');
  });

  it('accepts athletes aged 5 to 25 by birth year', () => {
    expect(athleteBirthDateInRange('2021-12-31', '2026-01-10')).toBe(true);
    expect(athleteBirthDateInRange('2022-01-01', '2026-01-10')).toBe(false);
    expect(athleteBirthDateInRange('2001-01-01', '2026-01-10')).toBe(true);
    expect(athleteBirthDateInRange('2000-12-31', '2026-01-10')).toBe(false);
    expect(athleteBirthDateInRange('2026-02-01', '2026-01-10')).toBe(false);
  });

  it('reports an out-of-range athlete birth date on the person.birthDate field', () => {
    const res = AthleteCreate.safeParse({
      person: { lastName: 'Петров', firstName: 'Иван', birthDate: '1970-01-01', gender: 'MALE' },
      organizationId: '01920000-0000-7000-8000-000000000002',
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['person', 'birthDate']);
    expect(res.error?.issues[0]?.message).toBe('birth_date_out_of_range');
  });

  it('formats weight limits by locale', () => {
    expect(weightLabelKg(38000, 'ru')).toBe('38');
    expect(weightLabelKg(38500, 'ru')).toBe('38,5');
    expect(weightLabelKg(38500, 'en')).toBe('38.5');
  });
});
