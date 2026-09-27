// Публичное API витрины (API.md, 5.9) для серверных страниц: без cookie и CSRF. Браузер эти запросы не делает —
// страницы рендерятся на сервере web. Ответы кэшируются в процессе на 60 секунд (как Cache-Control самого API),
// включая «не найдено»: все посетители приходят в API с адреса сервера web, и без кэша лимит публичного API
// (120 запросов в минуту на IP) расходовался бы на всех посетителей сразу.

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

export class PublicApiError extends Error {
  constructor(readonly status: number) {
    super(`public api ${status}`);
  }
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

async function load<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new PublicApiError(res.status);
  return (await res.json()) as T;
}

export function publicApi<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  const url = `${API}/api/public/v1${path}${qs ? `?${qs}` : ''}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load<T>(url);
  cache.delete(url);
  cache.set(url, { at: Date.now(), value });
  // Самая старая запись вытесняется: случайные адреса не раздувают память.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  // Сбой API не кэшируется — следующий посетитель повторит запрос; «не найдено» кэшируется.
  value.catch((e: unknown) => {
    if (!(e instanceof PublicApiError && e.status === 404)) cache.delete(url);
  });
  return value;
}
