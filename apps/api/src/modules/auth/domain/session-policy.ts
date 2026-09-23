// Правила сессий и refresh token (API.md, 3.1; ARCHITECTURE.md, 6). Чистые функции.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Скользящее окно refresh token. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Абсолютный максимум сессии независимо от ротаций. */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface RefreshTokenState {
  revokedAt: Date | null;
  replacedById: string | null;
  expiresAt: Date;
}

export type RefreshVerdict = 'VALID' | 'REUSED' | 'EXPIRED';

/**
 * Refresh token действителен один раз. Предъявление уже заменённого или отозванного токена —
 * признак кражи: отзывается всё семейство (сессия) целиком.
 */
export function classifyRefresh(token: RefreshTokenState, now: Date): RefreshVerdict {
  if (token.replacedById !== null || token.revokedAt !== null) return 'REUSED';
  if (token.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'VALID';
}

/** Срок нового refresh token: 30 дней от сейчас, но не дальше 90 дней от начала сессии. */
export function nextRefreshExpiry(now: Date, sessionStartedAt: Date): Date {
  const sliding = now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000;
  const absolute = sessionStartedAt.getTime() + SESSION_MAX_AGE_SECONDS * 1000;
  return new Date(Math.min(sliding, absolute));
}

export function sessionExhausted(now: Date, sessionStartedAt: Date): boolean {
  return now.getTime() >= sessionStartedAt.getTime() + SESSION_MAX_AGE_SECONDS * 1000;
}
