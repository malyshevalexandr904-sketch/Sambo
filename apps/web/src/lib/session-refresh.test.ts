import { describe, expect, it } from 'vitest';
import { coordinatedRefresh, type RefreshDeps } from './session-refresh';

/** Две вкладки одного браузера: общая блокировка (по очереди) и общие cookie (сессия одна). */
function browser() {
  let tail: Promise<unknown> = Promise.resolve();
  const cookies = { fresh: false };
  let refreshes = 0;
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
  const tab = (): RefreshDeps => ({
    withLock,
    sessionAlive: async () => cookies.fresh,
    refresh: async () => {
      refreshes += 1;
      // Строгая ротация: второй предъявленный старый refresh token отзывает сессию.
      if (refreshes > 1) throw new Error('REFRESH_TOKEN_REUSED');
      await new Promise((r) => setTimeout(r, 5));
      cookies.fresh = true;
      return true;
    },
  });
  return { tab, refreshes: () => refreshes };
}

describe('session refresh across tabs', () => {
  it('two tabs whose token expired at the same moment refresh the session once', async () => {
    const b = browser();
    const [a, c] = await Promise.all([coordinatedRefresh(b.tab()), coordinatedRefresh(b.tab())]);
    expect([a, c]).toEqual([true, true]);
    expect(b.refreshes()).toBe(1);
  });

  it('a tab whose session is still valid does not refresh', async () => {
    let refreshed = false;
    const ok = await coordinatedRefresh({
      withLock: (fn) => fn(),
      sessionAlive: async () => true,
      refresh: async () => {
        refreshed = true;
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(refreshed).toBe(false);
  });
});
