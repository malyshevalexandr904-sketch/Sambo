// Публичное API витрины (API.md, 5.9) для серверных страниц: без cookie и CSRF, ответ кэшируется на 60 секунд
// (как и Cache-Control самого API). Браузер эти запросы не делает — страницы рендерятся на сервере.

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export class PublicApiError extends Error {
  constructor(readonly status: number) {
    super(`public api ${status}`);
  }
}

export async function publicApi<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  const res = await fetch(`${API}/api/public/v1${path}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new PublicApiError(res.status);
  return (await res.json()) as T;
}
