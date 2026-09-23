import { describe, expect, it } from 'vitest';
import {
  classifyRefresh,
  nextRefreshExpiry,
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  sessionExhausted,
} from './session-policy';

const now = new Date('2026-11-01T10:00:00Z');
const later = new Date(now.getTime() + 60_000);

describe('refresh token rotation', () => {
  it('accepts a fresh, unused token', () => {
    expect(classifyRefresh({ revokedAt: null, replacedById: null, expiresAt: later }, now)).toBe('VALID');
  });

  it('treats a token that was already rotated as reuse (theft signal)', () => {
    expect(classifyRefresh({ revokedAt: null, replacedById: 'next', expiresAt: later }, now)).toBe('REUSED');
  });

  it('treats a revoked token as reuse', () => {
    expect(classifyRefresh({ revokedAt: now, replacedById: null, expiresAt: later }, now)).toBe('REUSED');
  });

  it('rejects expired tokens', () => {
    expect(classifyRefresh({ revokedAt: null, replacedById: null, expiresAt: now }, now)).toBe('EXPIRED');
  });

  it('slides the refresh window by 30 days', () => {
    expect(nextRefreshExpiry(now, now).getTime() - now.getTime()).toBe(REFRESH_TOKEN_TTL_SECONDS * 1000);
  });

  it('never extends a session beyond 90 days from its start', () => {
    const started = new Date(now.getTime() - (SESSION_MAX_AGE_SECONDS - 3600) * 1000);
    expect(nextRefreshExpiry(now, started).getTime()).toBe(
      started.getTime() + SESSION_MAX_AGE_SECONDS * 1000,
    );
    expect(sessionExhausted(now, started)).toBe(false);
    expect(sessionExhausted(new Date(now.getTime() + 3600_000), started)).toBe(true);
  });
});
