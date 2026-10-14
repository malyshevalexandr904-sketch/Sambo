// «Скоро выступает» (Phase 8b; план §2): какие схватки ковра пора объявить — перед ними осталось не больше N схваток.
// Чистая функция без БД: очередь ковра так, как её видит планшет (scheduling/domain/queue.ts, 7a): идущие и
// вызванные — впереди всех; ждущие пары с другого ковра ковёр не держат и в счёт не идут.
import { createHash } from 'node:crypto';

export interface SoonQueueItem {
  matchId: string;
  /** Плановое начало (мс эпохи) и порядок на ковре. */
  plannedAt: number;
  orderInMat: number;
  status: 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'PAUSED';
  /** Оба участника известны. */
  paired: boolean;
  /** Хотя бы один участник снят — схватка решится неявкой без борьбы. */
  withdrawn: boolean;
}

export interface SoonDue {
  matchId: string;
  /** Сколько схваток впереди на ковре (0 — следующая). */
  ahead: number;
}

/** Окно «скоро»: схватка запланирована не позже чем через 2 часа (позже — ещё рано, ковёр может сдвинуться). */
export const SOON_WINDOW_MS = 2 * 60 * 60 * 1000;

const ACTIVE = new Set<SoonQueueItem['status']>(['READY', 'IN_PROGRESS', 'PAUSED']);

const precedes = (a: SoonQueueItem, b: SoonQueueItem): boolean =>
  a.plannedAt < b.plannedAt ||
  (a.plannedAt === b.plannedAt &&
    (a.orderInMat < b.orderInMat || (a.orderInMat === b.orderInMat && a.matchId < b.matchId)));

/**
 * Схватки одного ковра, о которых пора уведомить: ещё не вызваны, пара известна, никто не снят, начало — в окне,
 * впереди не больше `ahead` схваток (идущие и вызванные; ждущие по плану раньше — если их пара известна).
 */
export function dueSoon(items: readonly SoonQueueItem[], ahead: number, nowMs: number): SoonDue[] {
  if (ahead <= 0) return [];
  const out: SoonDue[] = [];
  for (const m of items) {
    if (m.status !== 'SCHEDULED' || !m.paired || m.withdrawn) continue;
    if (m.plannedAt > nowMs + SOON_WINDOW_MS) continue;
    const before = items.filter(
      (o) => o.matchId !== m.matchId && (ACTIVE.has(o.status) || (o.paired && precedes(o, m))),
    ).length;
    if (before <= ahead) out.push({ matchId: m.matchId, ahead: before });
  }
  return out;
}

/**
 * Детерминированный идентификатор источника уведомления (`notification.source_event_id`): повторная проверка
 * очереди или повтор задачи не создаёт второе уведомление тому же получателю. Формат UUID (версия 8).
 */
export function sourceKey(...parts: string[]): string {
  const h = createHash('sha256')
    .update(`sde:notification:${parts.join(':')}`)
    .digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x80;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
