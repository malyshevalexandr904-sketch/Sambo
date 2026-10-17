import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch: CSRF-запрос (без cookie в node) — пустой ответ, затем ответ на сам запрос. */
function stubFetch(response: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/auth/csrf') ? new Response(null, { status: 200 }) : response,
    ),
  );
}

describe('api', () => {
  it('202 без тела («письмо отправлено») — успех без данных, а не ошибка разбора JSON', async () => {
    stubFetch(new Response(null, { status: 202 }));
    await expect(
      api('/auth/password/forgot', { method: 'POST', body: { email: 'a@b.ru' }, noRefresh: true }),
    ).resolves.toBeUndefined();
  });

  it('ответ с телом разбирается как JSON', async () => {
    stubFetch(new Response(JSON.stringify({ data: { status: 'VERIFICATION_SENT' } }), { status: 202 }));
    await expect(api('/auth/register', { method: 'POST', body: {}, noRefresh: true })).resolves.toEqual({
      data: { status: 'VERIFICATION_SENT' },
    });
  });
});
