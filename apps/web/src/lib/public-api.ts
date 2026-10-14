// Публичное API витрины (API.md, 5.9) для серверных страниц: без cookie и CSRF. Браузер эти запросы не делает —
// страницы рендерятся на сервере web. Ответы кэшируются в процессе, включая «не найдено»: все посетители приходят
// в API с адреса сервера web, и без кэша лимит публичного API (120 запросов в минуту на IP) расходовался бы на всех
// посетителей сразу. Кэш сбрасывается по событию (канал `public:competitions`, Phase 8b) — страницы турнира
// показывают изменения сразу; 60 секунд — запасной срок, пока соединения с живыми данными нет.
import { publicFeedReady, startPublicCacheFeed } from './public-cache-feed';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const PREFIX = `${API}/api/public/v1`;
/** Без соединения с каналом сброса — как Cache-Control самого API. */
const TTL_MS = 60_000;
/** С соединением: изменения приходят событием, срок — страховка от потерянного сообщения. */
const TTL_LIVE_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

export class PublicApiError extends Error {
  constructor(readonly status: number) {
    super(`public api ${status}`);
  }
}

type Entry = { at: number; value: Promise<unknown> };
const g = globalThis as typeof globalThis & { __sdePublicApiCache?: Map<string, Entry> };
const cache = (g.__sdePublicApiCache ??= new Map<string, Entry>());

/** Темы, после которых меняется и список турниров (название, даты, статус, приём заявок). */
const LIST_TOPICS = new Set(['competition']);

/**
 * Сбросить кэш: `slug` — ответы этого турнира (`/competitions/{slug}` и вложенные), при изменении самого турнира —
 * и список; `null` — всё.
 */
export function invalidatePublic(slug: string | null, topics: readonly string[]): void {
  if (slug === null) {
    cache.clear();
    return;
  }
  const own = `/competitions/${encodeURIComponent(slug)}`;
  const list = topics.some((t) => LIST_TOPICS.has(t));
  for (const url of [...cache.keys()]) {
    const path = url.slice(PREFIX.length);
    const rest = path.startsWith(own) ? path.slice(own.length) : null;
    if (rest !== null && (rest === '' || rest.startsWith('/') || rest.startsWith('?'))) cache.delete(url);
    else if (list && (path === '/competitions' || path.startsWith('/competitions?'))) cache.delete(url);
  }
}

async function load<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new PublicApiError(res.status);
  return (await res.json()) as T;
}

export function publicApi<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  startPublicCacheFeed(API, invalidatePublic);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  const url = `${PREFIX}${path}${qs ? `?${qs}` : ''}`;
  const hit = cache.get(url);
  const ttl = publicFeedReady() ? TTL_LIVE_MS : TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load<T>(url);
  cache.delete(url);
  cache.set(url, { at: Date.now(), value });
  // Самая старая запись вытесняется: случайные адреса не раздувают память.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  // Сбой API не кэшируется — следующий посетитель повторит запрос; «не найдено» кэшируется.
  value.catch((e: unknown) => {
    if (!(e instanceof PublicApiError && e.status === 404) && cache.get(url)?.value === value)
      cache.delete(url);
  });
  return value;
}
