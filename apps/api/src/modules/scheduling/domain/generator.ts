// Автопланировщик (Phase 6, раздел 2): чистая функция без БД — тот же вход даёт то же расписание. Категория
// целиком на одном ковре; категории без закрепления распределяются по ковру с наименьшей загрузкой, крупные —
// первыми (LPT). Внутри ковра схватки идут по порядку категорий, затем по кругам (brackets.numberingOrder):
// зависимости схватки всегда раньше неё в этом порядке — отдельного топологического обхода не нужно.
// Блок финалов (раздел 6) — вторым проходом: финалы и схватки за 3-е место не раньше конца обычной части
// на всех коврах.
import type {
  CategoryInput,
  MatchInput,
  MatInput,
  MatLoad,
  PlacedMatch,
  ScheduleWarning,
  SessionInput,
  UnassignedMatch,
} from './types';

export interface GenerateScheduleInput {
  sessions: readonly SessionInput[];
  mats: readonly MatInput[];
  categories: readonly CategoryInput[];
  matches: readonly MatchInput[];
  matChangeoverSeconds: number;
  minRestSeconds: number;
  /** Финалы и схватки за 3-е место — общим блоком в конце дня на всех коврах (по умолчанию — да). */
  finalsBlock: boolean;
}

export interface GenerateScheduleResult {
  placements: PlacedMatch[];
  unassigned: UnassignedMatch[];
  /** Для сгенерированного вручную не тронутого расписания список обычно пуст: генератор сам соблюдает отдых. */
  warnings: ScheduleWarning[];
  matLoad: MatLoad[];
}

interface Cursor {
  /** Индекс текущей сессии в глобальном отсортированном списке. */
  sessionIndex: number;
  /** Освобождается (эпоха, секунды) — с учётом времени на смену пары. Null — ковёр ещё не занят. */
  freeAt: number | null;
}

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

/** Устойчивая сортировка: значение ключа, затем id — детерминированно при равенстве. */
function stableSort<T>(rows: readonly T[], key: (r: T) => [number, string]): T[] {
  return [...rows].sort((a, b) => {
    const [ka, ida] = key(a);
    const [kb, idb] = key(b);
    return ka - kb || (ida < idb ? -1 : ida > idb ? 1 : 0);
  });
}

/** Категория → ковёр: закрепление, затем уже закреплённые схватки (первая по id), затем LPT по загрузке. */
function assignCategoriesToMats(
  categories: readonly CategoryInput[],
  matches: readonly MatchInput[],
  mats: readonly MatInput[],
  matIds: ReadonlySet<string>,
): Map<string, string> {
  const matOf = new Map<string, string>();
  for (const c of categories) {
    if (c.pinnedMatId && matIds.has(c.pinnedMatId)) matOf.set(c.id, c.pinnedMatId);
  }
  for (const m of stableSort(matches, (m) => [0, m.id])) {
    if (matOf.has(m.categoryId)) continue;
    if (m.pinned && matIds.has(m.pinned.matId)) matOf.set(m.categoryId, m.pinned.matId);
  }
  // Длительности схваток категории достаточно для сравнения загрузки: смена пары добавляет
  // примерно одинаковый по счёту схваток довесок и на выбор ковра почти не влияет.
  const totalOf = new Map<string, number>();
  for (const m of matches) totalOf.set(m.categoryId, (totalOf.get(m.categoryId) ?? 0) + m.durationSeconds);
  const load = new Map<string, number>(mats.map((m) => [m.id, 0]));
  for (const [categoryId, matId] of matOf) load.set(matId, (load.get(matId) ?? 0) + (totalOf.get(categoryId) ?? 0));
  const unpinned = stableSort(
    categories.filter((c) => !matOf.has(c.id)),
    (c) => [-(totalOf.get(c.id) ?? 0), c.id],
  );
  const matsSorted = [...mats].sort((a, b) => a.number - b.number);
  for (const c of unpinned) {
    let best = matsSorted[0];
    for (const m of matsSorted) if ((load.get(m.id) ?? 0) < (load.get(best?.id ?? '') ?? Infinity)) best = m;
    if (!best) continue;
    matOf.set(c.id, best.id);
    load.set(best.id, (load.get(best.id) ?? 0) + (totalOf.get(c.id) ?? 0));
  }
  return matOf;
}

/** Схватки ковра, кроме закреплённых (генерация их не трогает), в порядке категорий и кругов. */
function queueFor(
  matId: string,
  matches: readonly MatchInput[],
  matOf: ReadonlyMap<string, string>,
  categorySort: ReadonlyMap<string, number>,
  finalsPhase: boolean,
  finalsBlock: boolean,
): MatchInput[] {
  const rows = matches.filter(
    (m) =>
      !m.pinned &&
      matOf.get(m.categoryId) === matId &&
      (!finalsBlock || m.isFinalsBlock === finalsPhase),
  );
  return stableSort(rows, (m) => [
    (categorySort.get(m.categoryId) ?? 0) * 1_000_000 + m.orderInCategory,
    m.id,
  ]);
}

/** Занятые ковром слоты (закреплённые и уже размещённые в этом прогоне) — для следующего свободного orderInMat. */
function nextOrder(taken: ReadonlySet<string>, sessionId: string, matId: string): number {
  let n = 1;
  while (taken.has(`${sessionId}:${matId}:${n}`)) n += 1;
  return n;
}

export function generateSchedule(input: GenerateScheduleInput): GenerateScheduleResult {
  const sessions = [...input.sessions].sort((a, b) => a.startsAt - b.startsAt);
  const mats = [...input.mats].sort((a, b) => a.number - b.number);
  const matIds = new Set(mats.map((m) => m.id));
  const matchById = byId(input.matches);
  const categorySort = new Map(input.categories.map((c) => [c.id, c.sortOrder]));
  const matOf = assignCategoriesToMats(input.categories, input.matches, mats, matIds);

  const placements: PlacedMatch[] = [];
  const unassigned: UnassignedMatch[] = [];
  const warnings: ScheduleWarning[] = [];
  const endOf = new Map<string, number>();
  const athleteBusyUntil = new Map<string, number>();
  const takenSlots = new Set<string>();
  for (const m of input.matches) if (m.pinned) takenSlots.add(`${m.pinned.sessionId}:${m.pinned.matId}:${m.pinned.orderInMat}`);

  if (mats.length === 0) {
    for (const m of input.matches)
      if (!m.pinned) unassigned.push({ matchId: m.id, categoryId: m.categoryId, reason: 'no_active_mats' });
    return { placements, unassigned, warnings, matLoad: [] };
  }

  const cursors = new Map<string, Cursor>(mats.map((m) => [m.id, { sessionIndex: 0, freeAt: null }]));

  const place = (mat: MatInput, match: MatchInput, floor: number): void => {
    const cursor = cursors.get(mat.id) as Cursor;
    for (;;) {
      const session = sessions[cursor.sessionIndex];
      if (!session) {
        unassigned.push({ matchId: match.id, categoryId: match.categoryId, reason: 'no_session_capacity' });
        return;
      }
      const start = Math.max(floor, cursor.freeAt ?? session.startsAt, session.startsAt);
      const end = start + match.durationSeconds;
      if (end > session.endsAt) {
        cursor.sessionIndex += 1;
        cursor.freeAt = null;
        continue;
      }
      const order = nextOrder(takenSlots, session.id, mat.id);
      takenSlots.add(`${session.id}:${mat.id}:${order}`);
      placements.push({ matchId: match.id, sessionId: session.id, matId: mat.id, orderInMat: order, plannedAt: start, endsAt: end });
      endOf.set(match.id, end);
      cursor.freeAt = end + input.matChangeoverSeconds;
      for (const a of match.athleteIds) athleteBusyUntil.set(a, Math.max(athleteBusyUntil.get(a) ?? 0, end + input.minRestSeconds));
      return;
    }
  };

  const floorFor = (match: MatchInput): number => {
    let floor = 0;
    for (const dep of match.dependsOn) {
      const depEnd = endOf.get(dep);
      if (depEnd !== undefined) floor = Math.max(floor, depEnd + input.minRestSeconds);
    }
    for (const a of match.athleteIds) floor = Math.max(floor, athleteBusyUntil.get(a) ?? 0);
    return floor;
  };

  for (const mat of mats) {
    for (const match of queueFor(mat.id, input.matches, matOf, categorySort, false, input.finalsBlock))
      place(mat, match, floorFor(match));
  }

  if (input.finalsBlock) {
    const globalFloor = Math.max(0, ...mats.map((m) => cursors.get(m.id)?.freeAt ?? 0));
    for (const mat of mats) {
      const cursor = cursors.get(mat.id) as Cursor;
      cursor.freeAt = Math.max(cursor.freeAt ?? 0, globalFloor);
      for (const match of queueFor(mat.id, input.matches, matOf, categorySort, true, true))
        place(mat, match, Math.max(floorFor(match), globalFloor));
    }
  }

  const matLoad: MatLoad[] = mats.map((mat) => ({
    matId: mat.id,
    totalSeconds: placements
      .filter((p) => p.matId === mat.id)
      .reduce((sum, p) => sum + (matchById.get(p.matchId)?.durationSeconds ?? 0), 0),
  }));

  return { placements, unassigned, warnings, matLoad };
}
