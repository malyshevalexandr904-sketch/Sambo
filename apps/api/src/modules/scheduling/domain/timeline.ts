// Пересчёт времени по уже заданной расстановке (Phase 6, раздел 3): ручная правка не решает, где стоит схватка
// (это решил человек — сессия, ковёр, порядок), а только время и предупреждения. Единственный жёсткий запрет —
// схватка не может стоять раньше схваток, от которых зависит (обнаруживается как «тупик» обхода: ни один фронт
// ни одного ковра не готов, а схватки ещё остались). Отдых меньше минимального и переполнение сессии —
// предупреждения: сохранить можно (запрет «не двигать начатую схватку» проверяет вызывающий — по статусу схватки,
// который эта чистая функция не знает).
import type { PlacedMatch, ScheduleWarning, SessionInput } from './types';

export interface TimelineItem {
  matchId: string;
  sessionId: string;
  matId: string;
  orderInMat: number;
  durationSeconds: number;
  dependsOn: readonly string[];
  athleteIds: readonly string[];
}

export interface ComputeTimelineInput {
  items: readonly TimelineItem[];
  sessions: readonly SessionInput[];
  minRestSeconds: number;
  matChangeoverSeconds: number;
}

export interface TimelineOrderViolation {
  matchId: string;
  /** Схватка из dependsOn, которая на момент тупика ещё не сыграна по этой расстановке. */
  blockedOn: string;
}

export interface ComputeTimelineResult {
  placements: PlacedMatch[];
  warnings: ScheduleWarning[];
  /** Непусто — расстановка нарушает порядок зависимостей; placements/warnings в этом случае неполны. */
  orderViolations: TimelineOrderViolation[];
}

export function computeTimeline(input: ComputeTimelineInput): ComputeTimelineResult {
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const matIds = [...new Set(input.items.map((i) => i.matId))];
  const queues = new Map(
    matIds.map((matId) => [
      matId,
      [...input.items.filter((i) => i.matId === matId)].sort((a, b) => a.orderInMat - b.orderInMat),
    ]),
  );
  const knownMatchIds = new Set(input.items.map((i) => i.matchId));
  const ptr = new Map(matIds.map((m) => [m, 0]));
  const freeAt = new Map<string, number>();
  const scheduledEnd = new Map<string, number>();
  const athleteLastEnd = new Map<string, number>();
  const placements: PlacedMatch[] = [];
  const warnings: ScheduleWarning[] = [];
  let remaining = input.items.length;

  while (remaining > 0) {
    let bestMat: string | null = null;
    let bestItem: TimelineItem | null = null;
    let bestStart = Infinity;
    const blocked: TimelineOrderViolation[] = [];
    for (const matId of matIds) {
      const idx = ptr.get(matId) as number;
      const queue = queues.get(matId) as TimelineItem[];
      const item = queue[idx];
      if (!item) continue;
      const unmet = item.dependsOn.filter((d) => knownMatchIds.has(d) && !scheduledEnd.has(d));
      if (unmet.length > 0) {
        blocked.push({ matchId: item.matchId, blockedOn: unmet[0] as string });
        continue;
      }
      const session = sessionById.get(item.sessionId);
      const depFloor = Math.max(0, ...item.dependsOn.map((d) => scheduledEnd.get(d) ?? 0));
      const start = Math.max(freeAt.get(matId) ?? -Infinity, session?.startsAt ?? 0, depFloor, 0);
      if (start < bestStart || (start === bestStart && matId < (bestMat ?? matId))) {
        bestStart = start;
        bestMat = matId;
        bestItem = item;
      }
    }
    if (!bestMat || !bestItem) return { placements, warnings, orderViolations: dedupeViolations(blocked) };

    const item = bestItem;
    const start = bestStart;
    const end = start + item.durationSeconds;
    scheduledEnd.set(item.matchId, end);
    freeAt.set(bestMat, end + input.matChangeoverSeconds);
    ptr.set(bestMat, (ptr.get(bestMat) as number) + 1);
    remaining -= 1;
    placements.push({ matchId: item.matchId, sessionId: item.sessionId, matId: item.matId, orderInMat: item.orderInMat, plannedAt: start, endsAt: end });

    for (const dep of item.dependsOn) {
      const depEnd = scheduledEnd.get(dep);
      if (depEnd === undefined) continue;
      const gap = start - depEnd;
      if (gap < input.minRestSeconds)
        warnings.push({ matchId: item.matchId, kind: 'rest_dependency', shortfallSeconds: input.minRestSeconds - gap });
    }
    for (const athleteId of item.athleteIds) {
      const prevEnd = athleteLastEnd.get(athleteId);
      if (prevEnd !== undefined) {
        const gap = start - prevEnd;
        if (gap < input.minRestSeconds)
          warnings.push({ matchId: item.matchId, kind: 'rest_athlete', shortfallSeconds: input.minRestSeconds - gap });
      }
      athleteLastEnd.set(athleteId, Math.max(prevEnd ?? -Infinity, end));
    }
    const session = sessionById.get(item.sessionId);
    if (session && end > session.endsAt)
      warnings.push({ matchId: item.matchId, kind: 'session_overflow', shortfallSeconds: end - session.endsAt });
  }

  return { placements, warnings, orderViolations: [] };
}

function dedupeViolations(rows: TimelineOrderViolation[]): TimelineOrderViolation[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.matchId) ? false : (seen.add(r.matchId), true)));
}
