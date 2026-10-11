// Состояние табло ковра (Phase 8a): снимок с сервера и живые сообщения канала `public:mat`. Сообщения о схватке
// могут прийти не по порядку (две публикации подряд) — более старое состояние той же схватки табло не показывает.
import {
  isNewerMatchState,
  LIVE_LAST_RESULT_MS,
  type LiveMatchDto,
  type PublicMatStateDto,
} from '@sde/contracts';

/**
 * Новое состояние ковра. Состояние, посчитанное раньше показанного (снимок подписки после свежего ответа REST,
 * запоздавшая публикация), не показывается; текущая схватка — не старее показанной.
 */
export function mergeMatState(
  shown: PublicMatStateDto | null,
  incoming: PublicMatStateDto,
): PublicMatStateDto {
  if (shown && Date.parse(incoming.serverTime) < Date.parse(shown.serverTime)) return shown;
  if (!shown || !shown.current || !incoming.current) return incoming;
  return isNewerMatchState(incoming.current, shown.current)
    ? incoming
    : { ...incoming, current: shown.current };
}

export type ScoreboardView =
  | { kind: 'live'; match: LiveMatchDto }
  | { kind: 'called'; match: LiveMatchDto }
  | { kind: 'result'; match: LiveMatchDto }
  | { kind: 'next'; match: LiveMatchDto }
  | { kind: 'idle' };

/**
 * Что показать крупно: идущая схватка (или пауза), вызванная пара, результат последней схватки (пока не вызвали
 * следующую и не прошёл час), следующая пара, иначе — пустой ковёр.
 */
export function scoreboardView(s: PublicMatStateDto, serverNowMs: number): ScoreboardView {
  const c = s.current;
  if (c && (c.status === 'IN_PROGRESS' || c.status === 'PAUSED')) return { kind: 'live', match: c };
  if (c && c.status === 'READY') return { kind: 'called', match: c };
  const last = s.last;
  if (last?.finishedAt && serverNowMs - Date.parse(last.finishedAt) < LIVE_LAST_RESULT_MS)
    return { kind: 'result', match: last };
  if (s.next) return { kind: 'next', match: s.next };
  return { kind: 'idle' };
}

/** Следующая пара для строки внизу — если её не показывают крупно. */
export function upNext(s: PublicMatStateDto, view: ScoreboardView): LiveMatchDto | null {
  if (view.kind === 'next' || !s.next) return null;
  return 'match' in view && view.match.publicId === s.next.publicId ? null : s.next;
}
