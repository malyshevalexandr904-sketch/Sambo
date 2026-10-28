// Демо-вход (правки 27.10.2026): все роли и разделы — только для просмотра. Любое действие не отправляется на сервер,
// а показывает окно «Пройдите регистрацию…»; сервер такие запросы тоже отклоняет (DEMO_READ_ONLY).
const SAFE = new Set(['GET', 'HEAD']);
export const DEMO_BLOCKED_EVENT = 'sde-demo-blocked';

let demo = false;

/** Режим берётся из «я» (`Me.demo`); выход из демо — новый вход или выход. */
export function setDemoMode(value: boolean): void {
  demo = value;
}

export const isDemoMode = (): boolean => demo;

/** Запрос — действие, запрещённое в демо: всё, кроме чтения, входа и выхода и переключения роли (это просмотр). */
export function demoBlocks(method: string, path: string): boolean {
  if (!demo || SAFE.has(method)) return false;
  return !(path.startsWith('/auth/') || path === '/me/role');
}

export function announceDemoBlocked(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_BLOCKED_EVENT));
}
