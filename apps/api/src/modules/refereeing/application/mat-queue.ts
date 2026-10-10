// Очередь ковра (Phase 7a; табло — Phase 8a): какие схватки ковра ещё впереди и какая из них текущая.
import { entryOn, type MatchRecord } from '../../matches';

/** Схватки, которые ещё впереди или идут (очередь ковра). */
export const UPCOMING = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'PAUSED'] as const;

/** Решена без игры: без соперника (BYE) или пустая — в очереди ковра не показывается. */
export const isNoMatch = (m: MatchRecord): boolean =>
  m.status === 'CANCELLED' || (m.status === 'FINISHED' && m.participants.some((p) => p.entryId === null));

/** Оба участника известны. */
export const bothKnown = (m: MatchRecord): boolean =>
  entryOn(m, 'RED') !== null && entryOn(m, 'BLUE') !== null;

/**
 * Текущая схватка ковра: идёт или на паузе, иначе вызванная, иначе первая по плану с известной парой (схватка,
 * ждущая победителя с другого ковра, не держит ковёр), иначе первая по плану.
 */
export function currentOf<T extends MatchRecord>(queue: readonly T[]): T | null {
  return (
    queue.find((m) => m.status === 'IN_PROGRESS' || m.status === 'PAUSED') ??
    queue.find((m) => m.status === 'READY') ??
    queue.find(bothKnown) ??
    queue[0] ??
    null
  );
}
