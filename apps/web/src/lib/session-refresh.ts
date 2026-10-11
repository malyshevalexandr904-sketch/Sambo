// Обновление сессии без гонки вкладок (Phase 8a, ревью): ротация refresh token строгая — повтор старого токена
// отзывает всю сессию. Вкладки одного браузера делят cookie: если две вкладки одновременно отправят /auth/refresh
// (истёк access token — сервер живых данных сообщает об этом всем соединениям в одну миллисекунду), вторая
// предъявит уже использованный токен, и пользователя выбросит из всех вкладок. Поэтому обновление идёт под
// блокировкой браузера (Web Locks API), а внутри неё сначала проверяется, не обновила ли сессию другая вкладка.

export interface RefreshDeps {
  /** Выполнить под блокировкой, общей для вкладок сайта (нет Web Locks — сразу). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Вход действует с текущими cookie (другая вкладка уже обновила сессию). */
  sessionAlive: () => Promise<boolean>;
  /** Обновить сессию по refresh token. */
  refresh: () => Promise<boolean>;
}

export function coordinatedRefresh(d: RefreshDeps): Promise<boolean> {
  return d.withLock(async () => (await d.sessionAlive()) || d.refresh());
}

const LOCK_NAME = 'sde-session-refresh';

/**
 * Блокировка между вкладками одного сайта. Без Web Locks (старый браузер или страница не по HTTPS) — случайная
 * пауза до 3 с: вкладки расходятся во времени, и проверка входа видит сессию, уже обновлённую другой вкладкой.
 */
export async function browserLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return await locks.request(LOCK_NAME, fn);
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 3_000));
  return fn();
}

/** Запрос под блокировкой не держит её дольше 10 с (зависшее соединение не останавливает остальные вкладки). */
export function lockedRequestSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(10_000)
    : undefined;
}
