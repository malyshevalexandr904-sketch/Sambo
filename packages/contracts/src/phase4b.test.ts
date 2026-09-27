import { describe, expect, it } from 'vitest';
import {
  ADMISSION_CHECK_KINDS,
  admissionStatusOf,
  attemptKindsForWindow,
  gramsToKg,
  kgToGrams,
  NotificationPreferencesPut,
  notificationLink,
  WeighInWindowInput,
  weighInResult,
} from './index.js';

describe('weight check (ARCHITECTURE.md, 14.3)', () => {
  const upTo38 = { kind: 'UP_TO' as const, lowerGrams: 35_000, upperGrams: 38_000 };
  const over38 = { kind: 'ABOVE' as const, lowerGrams: 38_000, upperGrams: null };
  const lightest = { kind: 'UP_TO' as const, lowerGrams: null, upperGrams: 35_000 };

  it('lower bound is exclusive, upper bound plus tolerance inclusive', () => {
    expect(weighInResult(35_000, upTo38, 0)).toBe('FAILED');
    expect(weighInResult(35_001, upTo38, 0)).toBe('PASSED');
    expect(weighInResult(38_000, upTo38, 0)).toBe('PASSED');
    expect(weighInResult(38_001, upTo38, 0)).toBe('FAILED');
    expect(weighInResult(38_200, upTo38, 200)).toBe('PASSED');
    expect(weighInResult(38_201, upTo38, 200)).toBe('FAILED');
  });

  it('"over" has no upper bound; the lightest "up to" has no lower bound', () => {
    expect(weighInResult(38_000, over38, 500)).toBe('FAILED');
    expect(weighInResult(95_000, over38, 0)).toBe('PASSED');
    expect(weighInResult(20_000, lightest, 0)).toBe('PASSED');
  });

  it('kilograms for input and display', () => {
    expect(kgToGrams('42,35')).toBe(42_350);
    expect(kgToGrams('42.355')).toBe(42_355);
    expect(kgToGrams(' 38 ')).toBe(38_000);
    expect(kgToGrams('38,')).toBeNull();
    expect(kgToGrams('abc')).toBeNull();
    expect(gramsToKg(42_350, 'ru')).toBe('42,35');
    expect(gramsToKg(38_000, 'en')).toBe('38.0');
    expect(gramsToKg(38_005, 'en')).toBe('38.005');
  });

  it('an official window takes official and recheck attempts, a control window — control and recheck', () => {
    expect(attemptKindsForWindow('OFFICIAL')).toEqual(['OFFICIAL', 'RECHECK']);
    expect(attemptKindsForWindow('CONTROL')).toEqual(['CONTROL', 'RECHECK']);
  });

  it('a window ends after it starts', () => {
    const base = {
      name: 'День 1',
      startsAt: '2026-11-14T06:00:00Z',
      categoryIds: ['0199aa00-0000-7000-8000-000000000001'],
    };
    expect(WeighInWindowInput.safeParse({ ...base, endsAt: '2026-11-14T08:00:00Z' }).success).toBe(true);
    expect(WeighInWindowInput.safeParse({ ...base, endsAt: '2026-11-14T06:00:00Z' }).success).toBe(false);
  });
});

describe('admission and notifications', () => {
  it('check kinds and status rule', () => {
    expect(ADMISSION_CHECK_KINDS).toContain('CHECK_IN');
    expect(admissionStatusOf([{ status: 'WAIVED' }])).toBe('ADMITTED');
  });

  it('notification links lead to the application or to documents; only email is configurable', () => {
    expect(notificationLink('application.returned', { applicationId: 'a1' })).toBe('/applications/a1');
    expect(notificationLink('document.rejected', { documentId: 'd1' })).toBe('/documents');
    expect(
      NotificationPreferencesPut.safeParse({
        preferences: [{ type: 'entry.rejected', channel: 'IN_APP', enabled: false }],
      }).success,
    ).toBe(false);
  });
});
