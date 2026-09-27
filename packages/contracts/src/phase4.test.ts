import { describe, expect, it } from 'vitest';
import { CategoryMergeRequest, CategoryWeightInput } from './competition-categories.js';
import { CompetitionCreate, RequirementInput, scheduleIssues } from './competitions.js';
import { localDateIn, localDateTimeIn, zonedToInstant } from './time.js';

describe('competition time zone helpers (ADR-13)', () => {
  it('converts between instants and local time of the competition', () => {
    expect(localDateIn('2026-11-01T20:59:59Z', 'Europe/Moscow')).toBe('2026-11-01');
    expect(localDateIn('2026-11-01T21:00:00Z', 'Europe/Moscow')).toBe('2026-11-02');
    expect(localDateTimeIn('2026-11-01T20:59:00Z', 'Europe/Moscow')).toBe('2026-11-01T23:59');
    expect(zonedToInstant('2026-11-01T23:59', 'Europe/Moscow')).toBe('2026-11-01T20:59:00.000Z');
    expect(zonedToInstant('2026-11-01T09:00', 'Asia/Vladivostok')).toBe('2026-10-31T23:00:00.000Z');
    // День перехода на летнее время (Берлин, 29 марта 2026): полдень — уже по летнему времени.
    expect(zonedToInstant('2026-03-29T12:00', 'Europe/Berlin')).toBe('2026-03-29T10:00:00.000Z');
    expect(zonedToInstant('2026-01-15T12:00', 'Europe/Berlin')).toBe('2026-01-15T11:00:00.000Z');
  });
});

describe('competition schedule', () => {
  const base = {
    timezone: 'Europe/Moscow',
    startDate: '2026-11-14',
    endDate: '2026-11-15',
    registrationStartsAt: '2026-10-01T00:00:00Z',
    registrationEndsAt: '2026-11-13T20:59:59Z',
  };

  it('checks dates and the registration window in the competition time zone', () => {
    expect(scheduleIssues(base)).toEqual([]);
    expect(scheduleIssues({ ...base, endDate: '2026-11-13' })).toEqual([
      { path: 'endDate', code: 'end_before_start' },
    ]);
    expect(scheduleIssues({ ...base, registrationStartsAt: base.registrationEndsAt })).toEqual([
      { path: 'registrationEndsAt', code: 'registration_window_invalid' },
    ]);
    expect(scheduleIssues({ ...base, registrationEndsAt: '2026-11-14T21:00:00Z' })).toEqual([
      { path: 'registrationEndsAt', code: 'registration_after_start' },
    ]);
  });

  it('CompetitionCreate reports schedule issues by field', () => {
    const r = CompetitionCreate.safeParse({
      name: 'Турнир',
      organizerOrganizationId: '01920000-0000-7000-8000-000000000001',
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
      ...base,
      endDate: '2026-11-01',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => [i.path.join('.'), i.message])).toContainEqual([
      'endDate',
      'end_before_start',
    ]);
  });
});

describe('category and requirement inputs', () => {
  it('weights: "up to" needs an upper bound above the lower one; "above" has only a lower bound', () => {
    expect(CategoryWeightInput.safeParse({ kind: 'UP_TO', upperGrams: 38000 }).success).toBe(true);
    expect(
      CategoryWeightInput.safeParse({ kind: 'UP_TO', lowerGrams: 38000, upperGrams: 35000 }).success,
    ).toBe(false);
    expect(CategoryWeightInput.safeParse({ kind: 'ABOVE', lowerGrams: 38000 }).success).toBe(true);
    expect(
      CategoryWeightInput.safeParse({ kind: 'ABOVE', lowerGrams: 38000, upperGrams: 40000 }).success,
    ).toBe(false);
  });

  it('requirements carry a document type or a consent kind as their kind demands', () => {
    expect(
      RequirementInput.safeParse({ kind: 'DOCUMENT', documentTypeCode: 'MEDICAL_CERTIFICATE' }).success,
    ).toBe(true);
    expect(RequirementInput.safeParse({ kind: 'DOCUMENT' }).success).toBe(false);
    expect(RequirementInput.safeParse({ kind: 'CONSENT', consentKind: 'HEALTH_DATA' }).success).toBe(true);
    expect(RequirementInput.safeParse({ kind: 'WEIGH_IN', consentKind: 'HEALTH_DATA' }).success).toBe(false);
  });

  it('a merge target is not among its sources', () => {
    const id = '01920000-0000-7000-8000-000000000001';
    expect(
      CategoryMergeRequest.safeParse({
        sourceCategoryIds: [id],
        targetCategoryId: id,
        reason: 'Мало участников',
      }).success,
    ).toBe(false);
  });
});
