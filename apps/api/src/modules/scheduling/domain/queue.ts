// Фактическое время ковра (план Phase 7a, §1): ожидаемое начало следующих схваток с учётом опоздания ковра.
// Плановое время расписания не переписывается: ожидаемое считается при чтении из того, что идёт сейчас.
// Чистая функция без БД: моменты — миллисекунды эпохи.
import type { MatchStatus } from '@sde/contracts';

export interface QueueItem {
  matchId: string;
  plannedAt: number;
  durationSeconds: number;
  status: MatchStatus;
  startedAt: number | null;
  /** Прошедшее время схватки по последнему показанию секундомера (идущая схватка). */
  elapsedMs: number;
}

export interface QueueProjection {
  expectedAt: Map<string, number>;
  /** Опоздание ковра, с: ожидаемое начало ближайшей несыгранной схватки минус плановое (не меньше 0). */
  delaySeconds: number;
}

const ACTIVE: readonly MatchStatus[] = ['IN_PROGRESS', 'PAUSED'];

/**
 * Очередь ковра в плановом порядке: идущая схватка заканчивается не раньше, чем через оставшееся время; каждая
 * следующая начинается не раньше планового времени и не раньше окончания предыдущей со сменой пары.
 */
export function projectQueue(
  items: readonly QueueItem[],
  nowMs: number,
  changeoverSeconds: number,
): QueueProjection {
  const expectedAt = new Map<string, number>();
  const changeover = changeoverSeconds * 1000;
  const sorted = [...items].sort((a, b) => a.plannedAt - b.plannedAt || (a.matchId < b.matchId ? -1 : 1));
  let cursor: number | null = null;
  // Идущие схватки — первыми: очередь продолжается от их окончания, даже если по плану они стояли позже.
  for (const item of sorted.filter((i) => ACTIVE.includes(i.status))) {
    expectedAt.set(item.matchId, item.startedAt ?? nowMs);
    const remaining = Math.max(0, item.durationSeconds * 1000 - item.elapsedMs);
    cursor = Math.max(cursor ?? 0, nowMs + remaining + changeover);
  }
  let delaySeconds: number | null = null;
  for (const item of sorted.filter((i) => !ACTIVE.includes(i.status))) {
    const start = Math.max(item.plannedAt, cursor ?? nowMs);
    expectedAt.set(item.matchId, start);
    delaySeconds ??= Math.max(0, Math.round((start - item.plannedAt) / 1000));
    cursor = start + item.durationSeconds * 1000 + changeover;
  }
  return { expectedAt, delaySeconds: delaySeconds ?? 0 };
}
