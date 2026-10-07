// Граница между БД и чистым планировщиком (Phase 6, §2; domain/types.ts): собирает вход генератора из
// опубликованных сеток и уже стоящих закреплённых мест, переводит время БД (Date) в секунды эпохи и обратно.
import { type LocalizedText, RuleSetParametersV1 } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { type BracketsService, type MatchDependency } from '../../brackets';
import { isPlayed, type MatchRecord, type MatchesService } from '../../matches';
import type { CategoryInput, MatchInput, MatInput, PinnedPlacement, SessionInput } from '../domain/types';

/** Минимальный отдых (правила турнира, RuleSetParametersV1); ruleset не назначен или не разобрался — запасное
 *  значение по умолчанию (rulesets.ts). */
export async function loadMinRestSeconds(db: Tx, competitionId: string): Promise<number> {
  const competition = await db.competition.findUnique({
    where: { id: competitionId },
    select: { ruleSetVersion: { select: { parameters: true } } },
  });
  const params = RuleSetParametersV1.safeParse(competition?.ruleSetVersion?.parameters ?? null);
  return params.success ? params.data.minRestSeconds : 600;
}

export const toEpoch = (d: Date): number => Math.floor(d.getTime() / 1000);
export const toDate = (epoch: number): Date => new Date(epoch * 1000);

/**
 * Схватка решена без игры (BYE на публикации сетки, либо соперник выбыл при продвижении позже — Phase 6, §2/§6):
 * `FINISHED` без обоих участников — WALKOVER, `CANCELLED` — обе стороны пусты (EMPTY). Такая схватка никогда не
 * входит в расписание: `matchNumber` ей либо не присваивается вовсе, либо (для схватки, ставшей WALKOVER
 * после публикации) сохраняется от момента, когда она ещё была открытой, — поэтому решает статус, а не номер.
 */
export function noMatch(m: Pick<MatchRecord, 'status' | 'participants'>): boolean {
  if (m.status === 'CANCELLED') return true;
  return m.status === 'FINISHED' && !isPlayed(m);
}

/** Схватка может участвовать в расписании: у нёе есть номер (создана открытой) и она не решена без игры. */
export function eligibleForScheduling(m: MatchRecord): boolean {
  return m.matchNumber !== null && !noMatch(m);
}

export interface CategoryRef {
  id: string;
  code: string;
  name: LocalizedText;
  sortOrder: number;
}

export interface ScheduleAssembly {
  categories: CategoryInput[];
  categoryRefs: Map<string, CategoryRef>;
  /** Схватки, годные для расстановки (см. eligibleForScheduling), без уже закреплённых — они в matches тоже есть,
   *  но помечены `pinned`, поэтому генератор их не переставляет. */
  matches: MatchInput[];
  matchById: Map<string, MatchRecord>;
}

/**
 * Вход планировщика по турниру: категории (порядок вкладки), схватки опубликованных сеток с зависимостями
 * (BracketsService.matchDependencies), длительностью, известными участниками и текущим закреплением (если
 * место в расписании уже есть и помечено «закреплено» — locked). Категории без опубликованной сетки не входят.
 */
export async function assembleSchedule(
  tx: Tx,
  brackets: BracketsService,
  matchesService: MatchesService,
  competitionId: string,
): Promise<ScheduleAssembly> {
  const categoryRows = await tx.competitionCategory.findMany({
    where: { competitionId },
    select: { id: true, code: true, nameRu: true, nameEn: true, sortOrder: true },
  });
  const categoryRefs = new Map<string, CategoryRef>(
    categoryRows.map((c) => [
      c.id,
      { id: c.id, code: c.code, name: { ru: c.nameRu, en: c.nameEn }, sortOrder: c.sortOrder },
    ]),
  );
  const draws = await tx.draw.findMany({
    where: { competitionId, status: 'PUBLISHED' },
    select: { id: true, categoryId: true },
  });

  const matchById = new Map<string, MatchRecord>();
  const dependencyById = new Map<string, MatchDependency>();
  for (const draw of draws) {
    const categoryMatches = await matchesService.byCategory(tx, draw.categoryId);
    for (const m of categoryMatches) matchById.set(m.id, m);
    const deps = await brackets.matchDependencies(tx, draw.id);
    for (const [id, d] of deps) dependencyById.set(id, d);
  }

  const entryIds = [
    ...new Set(
      [...matchById.values()].flatMap((m) =>
        m.participants.map((p) => p.entryId).filter((x): x is string => !!x),
      ),
    ),
  ];
  const entries = entryIds.length
    ? await tx.entry.findMany({ where: { id: { in: entryIds } }, select: { id: true, athleteId: true } })
    : [];
  const athleteOf = new Map(entries.map((e) => [e.id, e.athleteId]));

  const pinnedById = await loadPinned(tx, [...matchById.keys()]);
  const categoriesWithDraw = new Set(draws.map((d) => d.categoryId));

  const matches: MatchInput[] = [];
  for (const [id, m] of matchById) {
    if (!eligibleForScheduling(m)) continue;
    const dep = dependencyById.get(id);
    if (!dep) continue; // сетка не построена для узла (не должно происходить для OPEN-схватки) — пропускаем
    const athleteIds = dep.participantsKnown
      ? m.participants
          .map((p) => (p.entryId ? athleteOf.get(p.entryId) : undefined))
          .filter((x): x is string => !!x)
      : [];
    matches.push({
      id,
      categoryId: m.categoryId,
      orderInCategory: dep.orderInCategory,
      // Длительность назначается при публикации сетки по правилам категории и не бывает пустой у открытой
      // схватки; 0 — защитный запасной вариант, а не ожидаемое значение.
      durationSeconds: m.durationSeconds ?? 0,
      dependsOn: dep.dependsOn,
      athleteIds,
      isFinalsBlock: dep.isFinalsBlock,
      pinned: pinnedById.get(id),
    });
  }

  const categories: CategoryInput[] = [...categoriesWithDraw].map((id) => ({
    id,
    sortOrder: categoryRefs.get(id)?.sortOrder ?? 0,
  }));

  return { categories, categoryRefs, matches, matchById };
}

async function loadPinned(tx: Tx, matchIds: string[]): Promise<Map<string, PinnedPlacement>> {
  if (matchIds.length === 0) return new Map();
  const rows = await tx.matchSchedule.findMany({
    where: { matchId: { in: matchIds }, locked: true },
    select: { matchId: true, sessionId: true, matId: true, orderInMat: true },
  });
  return new Map(
    rows.map((r) => [r.matchId, { sessionId: r.sessionId, matId: r.matId, orderInMat: r.orderInMat }]),
  );
}

export function toMatInputs(rows: readonly { id: string; number: number }[]): MatInput[] {
  return rows.map((r) => ({ id: r.id, number: r.number }));
}

export function toSessionInputs(
  rows: readonly { id: string; startsAt: Date; endsAt: Date }[],
): SessionInput[] {
  return rows.map((r) => ({ id: r.id, startsAt: toEpoch(r.startsAt), endsAt: toEpoch(r.endsAt) }));
}
