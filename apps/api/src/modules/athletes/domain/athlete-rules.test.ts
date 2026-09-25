import { describe, expect, it } from 'vitest';
import {
  checkStatusChange,
  consentsStatus,
  dayBefore,
  electronicConsentDecision,
  isCurrent,
  primaryHandover,
} from './athlete-rules';

describe('athlete rules', () => {
  it('closes the previous primary club the day before the new one starts', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(primaryHandover({ validFrom: '2025-09-01' }, '2026-03-01')).toEqual({
      ok: true,
      closeCurrentAt: '2026-02-28',
    });
    expect(primaryHandover({ validFrom: '2026-03-01' }, '2026-03-01')).toEqual({ ok: false });
    expect(primaryHandover(null, '2026-03-01')).toEqual({ ok: true, closeCurrentAt: null });
  });

  it('treats a period as current until its last day', () => {
    expect(isCurrent(null, '2026-09-24')).toBe(true);
    expect(isCurrent('2026-09-24', '2026-09-24')).toBe(true);
    expect(isCurrent('2026-09-23', '2026-09-24')).toBe(false);
  });

  it('requires the archive permission to archive and to restore', () => {
    expect(checkStatusChange('ACTIVE', 'INACTIVE')).toEqual({ ok: true, permission: 'athlete.update' });
    expect(checkStatusChange('ACTIVE', 'ARCHIVED')).toEqual({ ok: true, permission: 'athlete.archive' });
    expect(checkStatusChange('ARCHIVED', 'ACTIVE')).toEqual({ ok: true, permission: 'athlete.archive' });
    expect(checkStatusChange('ARCHIVED', 'INACTIVE')).toEqual({ ok: false, allowed: ['ACTIVE'] });
    expect(checkStatusChange('ACTIVE', 'ACTIVE').ok).toBe(false);
  });

  it('summarizes consents by kind', () => {
    expect(consentsStatus(['PD_PROCESSING'])).toEqual({
      PD_PROCESSING: 'GIVEN',
      PD_DISTRIBUTION: 'MISSING',
      HEALTH_DATA: 'MISSING',
    });
  });

  it('lets only a verified guardian consent for a minor and the athlete for themselves from 18', () => {
    const today = '2026-09-24';
    const minor = '2013-05-10';
    const adult = '2008-09-24';
    expect(electronicConsentDecision({ relation: 'GUARDIAN', verified: true }, minor, today)).toBe('ALLOWED');
    expect(electronicConsentDecision({ relation: 'GUARDIAN', verified: false }, minor, today)).toBe(
      'GUARDIAN_NOT_VERIFIED',
    );
    expect(electronicConsentDecision({ relation: 'SELF' }, minor, today)).toBe('FORBIDDEN');
    expect(electronicConsentDecision({ relation: 'SELF' }, adult, today)).toBe('ALLOWED');
    expect(electronicConsentDecision({ relation: 'GUARDIAN', verified: true }, adult, today)).toBe(
      'FORBIDDEN',
    );
    expect(electronicConsentDecision(null, minor, today)).toBe('FORBIDDEN');
  });
});
