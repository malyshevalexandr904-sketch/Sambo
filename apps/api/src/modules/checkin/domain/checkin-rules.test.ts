import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canCheckIn, checkInTransitions, issueQrToken, qrExpiry, verifyQrToken } from './checkin-rules';

describe('check-in transitions (ARCHITECTURE.md, 16.4)', () => {
  it('expected → arrived | not arrived | withdrawn; not arrived → arrived; arrived → withdrawn', () => {
    expect(checkInTransitions('EXPECTED')).toEqual(['ARRIVED', 'NOT_ARRIVED', 'WITHDRAWN']);
    expect(canCheckIn('NOT_ARRIVED', 'ARRIVED')).toBe(true);
    expect(canCheckIn('ARRIVED', 'WITHDRAWN')).toBe(true);
    expect(canCheckIn('ARRIVED', 'NOT_ARRIVED')).toBe(false);
    expect(checkInTransitions('WITHDRAWN')).toEqual([]);
  });
});

describe('participant QR token', () => {
  const key = randomBytes(32);
  const claims = {
    competitionId: '0199aa00-0000-7000-8000-000000000001',
    athleteId: '0199aa00-0000-7000-8000-00000000abcd',
    exp: qrExpiry('2026-11-15'),
  };
  const now = new Date('2026-11-14T09:00:00Z');

  it('round-trips without personal data and fits a small QR', () => {
    const token = issueQrToken(key, claims);
    expect(token).toMatch(/^q1\.[\w-]+\.[\w-]+$/);
    expect(token.length).toBeLessThan(80);
    expect(verifyQrToken(key, token, now)).toEqual(claims);
  });

  it('rejects a forged, foreign-key, malformed or expired token', () => {
    const token = issueQrToken(key, claims);
    const [v, body, sig] = token.split('.');
    const other = issueQrToken(key, { ...claims, athleteId: '0199aa00-0000-7000-8000-00000000ffff' });
    expect(verifyQrToken(key, `${v}.${other.split('.')[1]}.${sig}`, now)).toBeNull();
    expect(verifyQrToken(randomBytes(32), token, now)).toBeNull();
    expect(verifyQrToken(key, `${v}.${body}`, now)).toBeNull();
    expect(verifyQrToken(key, 'garbage', now)).toBeNull();
    expect(verifyQrToken(key, token, new Date('2026-11-17T00:00:01Z'))).toBeNull();
  });

  it('expires at the end of the day after the competition ends (UTC)', () => {
    expect(new Date(qrExpiry('2026-11-15') * 1000).toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});
