// Cookie веб-сессии (API.md, 1.6): access — httpOnly на весь сайт, refresh — только на /api/v1/auth.
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_REFRESH, type TokenPair } from '@sde/contracts';
import type { CookieOptions, Response } from 'express';
import type { IssuedSession } from '../application/session.service';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function setSessionCookies(res: Response, session: IssuedSession, secure: boolean): void {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'lax' };
  res.cookie(COOKIE_ACCESS, session.accessToken, {
    ...base,
    path: '/',
    expires: session.accessTokenExpiresAt,
  });
  res.cookie(COOKIE_REFRESH, session.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshTokenExpiresAt,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'lax' };
  res.clearCookie(COOKIE_ACCESS, { ...base, path: '/' });
  res.clearCookie(COOKIE_REFRESH, { ...base, path: REFRESH_COOKIE_PATH });
}

/** CSRF-cookie читается скриптом веб-клиента и отправляется в заголовке X-CSRF-Token. */
export function setCsrfCookie(res: Response, value: string, secure: boolean): void {
  res.cookie(COOKIE_CSRF, value, { httpOnly: false, secure, sameSite: 'lax', path: '/' });
}

export function tokenPair(session: IssuedSession): TokenPair {
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
}
