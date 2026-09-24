// Клиент API (ARCHITECTURE.md, 23): тот же origin, cookie-сессия, CSRF double submit,
// прозрачное обновление access token (одно на все параллельные запросы).
import { type ApiErrorBody, COOKIE_CSRF, CSRF_HEADER, type ErrorCode, type FieldError } from '@sde/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    readonly details: Record<string, unknown> | undefined,
    readonly traceId: string | null,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  get fields(): FieldError[] {
    const fields = this.details?.fields;
    return Array.isArray(fields) ? (fields as FieldError[]) : [];
  }
}

const BASE = '/api/v1';
const SAFE = new Set(['GET', 'HEAD']);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<void> | null = null;

async function ensureCsrf(): Promise<string> {
  const existing = readCookie(COOKIE_CSRF);
  if (existing) return existing;
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' }).then(() => undefined);
  await csrfPromise;
  csrfPromise = null;
  return readCookie(COOKIE_CSRF) ?? '';
}

let refreshPromise: Promise<boolean> | null = null;

/** Одно обновление сессии на все запросы, получившие 401 одновременно (ротация refresh token строгая). */
function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const csrf = await ensureCsrf();
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { [CSRF_HEADER]: csrf },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();
  return refreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Версия ресурса для If-Match (API.md, 1.4). */
  version?: number;
  /** Не пытаться обновить сессию при 401 (сами запросы входа). */
  noRefresh?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.details, body.error.traceId);
  } catch {
    return new ApiError(res.status, 'UNKNOWN', undefined, res.headers.get('x-request-id'));
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE.has(method)) headers[CSRF_HEADER] = await ensureCsrf();
  if (opts.version !== undefined) headers['If-Match'] = `"v${opts.version}"`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', undefined, null);
  }
  if (res.status === 401 && !opts.noRefresh) {
    const err = await toError(res.clone());
    if ((err.code === 'TOKEN_EXPIRED' || err.code === 'UNAUTHENTICATED') && (await refreshSession())) {
      return api<T>(path, { ...opts, noRefresh: true });
    }
    throw err;
  }
  if (res.status === 403) {
    const err = await toError(res.clone());
    // CSRF-cookie могла смениться после входа в другой вкладке: берём новую и повторяем один раз.
    if (err.code === 'CSRF_TOKEN_INVALID' && !opts.noRefresh)
      return api<T>(path, { ...opts, noRefresh: true });
    throw err;
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Загрузка файла напрямую в хранилище по presigned POST (ADR-14). */
export async function uploadToStorage(
  url: string,
  fields: Record<string, string>,
  file: File,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', undefined, null);
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
