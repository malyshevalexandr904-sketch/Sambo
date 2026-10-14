// Что изменила правка опубликованного расписания (Phase 8b): клубу — сводка по всем схваткам, у которых сменились
// время или ковёр (в том числе сдвинутым пересчётом и впервые поставленным), семьям — «изменилось время» по тем,
// у которых сменился ковёр или время сдвинулось заметно. Сравнение — с местом до этой правки.

/** Семьям сообщается о сдвиге хотя бы на 10 минут (или о смене ковра); мелкие сдвиги покрывает «скоро выступает». */
export const TIME_CHANGE_NOTICE_MS = 10 * 60_000;

export interface Slot {
  matchId: string;
  matId: string;
  plannedAt: Date;
}

export interface ScheduleChanges {
  /** Сменились время или ковёр, поставлены впервые или убраны из расписания. */
  changed: string[];
  /** Сменился ковёр или время сдвинулось на `TIME_CHANGE_NOTICE_MS` и больше (впервые поставленные — нет). */
  noticeable: string[];
}

export function scheduleChanges(
  before: ReadonlyMap<string, { matId: string; plannedAt: Date }>,
  after: readonly Slot[],
): ScheduleChanges {
  const changed: string[] = [];
  const noticeable: string[] = [];
  const placed = new Set<string>();
  for (const a of after) {
    placed.add(a.matchId);
    const b = before.get(a.matchId);
    if (!b) {
      changed.push(a.matchId);
      continue;
    }
    const shift = Math.abs(a.plannedAt.getTime() - b.plannedAt.getTime());
    const matMoved = b.matId !== a.matId;
    if (!matMoved && shift === 0) continue;
    changed.push(a.matchId);
    if (matMoved || shift >= TIME_CHANGE_NOTICE_MS) noticeable.push(a.matchId);
  }
  for (const id of before.keys()) if (!placed.has(id)) changed.push(id);
  return { changed, noticeable };
}
