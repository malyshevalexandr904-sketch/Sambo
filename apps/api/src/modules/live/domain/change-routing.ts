// Изменения из журнала синхронизации → темы и адресаты живых каналов (Phase 8a; ARCHITECTURE.md, 13).
// Чистая функция: строки уведомлений `sde_live` (миграция 20261010000000_live) группируются по турнирам.
import type { LiveChangedPayload, LiveTopic } from '@sde/contracts';

/** Уведомление PostgreSQL `sde_live`: турнир, таблица, строка, операция; поля строки схватки, ковра, категории. */
export interface ChangeRow {
  c: string | null;
  t: string;
  id: string | null;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  m: string | null;
  cat: string | null;
  mat: string | null;
  v: string | null;
  s: string | null;
}

/** Тема по таблице. Таблиц без темы (служебных) в уведомлениях нет — журнал синхронизации их не пишет. */
export const TABLE_TOPICS: Readonly<Record<string, LiveTopic>> = {
  competition: 'competition',
  competition_membership: 'competition',
  competition_requirement: 'competition',
  venue: 'competition',
  competition_category: 'categories',
  category_rule: 'categories',
  application: 'registrations',
  entry: 'registrations',
  admission: 'admission',
  admission_check: 'admission',
  check_in: 'checkin',
  scale: 'weighin',
  weigh_in_window: 'weighin',
  weigh_in_window_category: 'weighin',
  weigh_in_attempt: 'weighin',
  weigh_in_record: 'weighin',
  medical_clearance: 'medical',
  draw: 'draws',
  draw_slot: 'draws',
  bracket: 'draws',
  bracket_node: 'draws',
  mat: 'schedule',
  session: 'schedule',
  schedule: 'schedule',
  match_schedule: 'schedule',
  mat_assignment: 'crews',
  match: 'matches',
  match_participant: 'matches',
  match_result: 'matches',
  match_result_revision: 'matches',
  match_event: 'matches',
  medical_incident: 'matches',
  category_result: 'results',
  placement: 'results',
  athlete_result: 'results',
};

/** Строки схватки: изменение касается схватки (её id — `m`, у самой схватки — `id`). */
const MATCH_ROW_TABLES = new Set([
  'match_participant',
  'match_result',
  'match_result_revision',
  'match_event',
  'medical_incident',
  'match_schedule',
]);

/** Изменение касается всех ковров турнира: сессии, расписание, бригады, сам турнир (название, статус). */
const ALL_MATS_TABLES = new Set(['session', 'schedule', 'mat_assignment', 'competition']);

/** Темы, о которых сообщает публичный канал турнира (без внутренних идентификаторов). */
export const PUBLIC_TOPICS: readonly LiveTopic[] = [
  'competition',
  'categories',
  'draws',
  'schedule',
  'matches',
  'results',
];

export interface CompetitionChanges {
  competitionId: string;
  /** Темы изменений статуса и данных (без изменений только счёта идущей схватки). */
  topics: Set<LiveTopic>;
  categoryIds: Set<string>;
  /** Ковры, известные по строкам (фактический ковёр схватки, ковёр расписания, сам ковёр). */
  matIds: Set<string>;
  /** Все затронутые схватки, включая изменения только счёта. */
  matchIds: Set<string>;
  /** Схватки, у которых изменился статус, стороны, результат или место в расписании. */
  statusMatchIds: Set<string>;
  /** Удалённые схватки (новая версия жеребьёвки). */
  deletedMatchIds: Set<string>;
  allMats: boolean;
}

/**
 * Версии схваток, уже опубликованные этим узлом: обновление строки схватки без смены версии — событие счёта
 * (команда события журнала версию не меняет), а не изменение статуса.
 */
export interface VersionMemory {
  /** true — версия та же, что в прошлый раз (только счёт). Запоминает новую версию. */
  sameVersion(matchId: string, version: number): boolean;
}

export class BoundedVersionMemory implements VersionMemory {
  private readonly versions = new Map<string, number>();
  constructor(private readonly limit = 10_000) {}

  sameVersion(matchId: string, version: number): boolean {
    const prev = this.versions.get(matchId);
    this.versions.delete(matchId);
    this.versions.set(matchId, version);
    if (this.versions.size > this.limit) {
      const oldest = this.versions.keys().next().value;
      if (oldest !== undefined) this.versions.delete(oldest);
    }
    return prev === version;
  }
}

export function groupChanges(rows: readonly ChangeRow[], memory: VersionMemory): CompetitionChanges[] {
  const out = new Map<string, CompetitionChanges>();
  for (const r of rows) {
    const topic = TABLE_TOPICS[r.t];
    if (!r.c || !topic) continue;
    let g = out.get(r.c);
    if (!g) {
      g = {
        competitionId: r.c,
        topics: new Set(),
        categoryIds: new Set(),
        matIds: new Set(),
        matchIds: new Set(),
        statusMatchIds: new Set(),
        deletedMatchIds: new Set(),
        allMats: false,
      };
      out.set(r.c, g);
    }
    if (r.cat) g.categoryIds.add(r.cat);
    if (r.t === 'competition_category' && r.id) g.categoryIds.add(r.id);
    if (r.mat) g.matIds.add(r.mat);
    if (r.t === 'mat' && r.id) g.matIds.add(r.id);
    if (ALL_MATS_TABLES.has(r.t)) g.allMats = true;
    const matchId = r.t === 'match' ? r.id : MATCH_ROW_TABLES.has(r.t) ? r.m : null;
    if (r.t === 'match' || MATCH_ROW_TABLES.has(r.t)) {
      if (r.op === 'DELETE') {
        // Удалённая строка без снимка: ковёр неизвестен — затронуты все ковры.
        g.allMats = true;
        if (r.t === 'match' && r.id) g.deletedMatchIds.add(r.id);
      }
      if (matchId) g.matchIds.add(matchId);
      const scoreOnly =
        r.t === 'match_event' ||
        (r.t === 'match' &&
          r.op === 'UPDATE' &&
          r.id !== null &&
          r.v !== null &&
          memory.sameVersion(r.id, Number(r.v)));
      if (r.t === 'match' && r.op !== 'UPDATE' && r.id && r.v !== null) memory.sameVersion(r.id, Number(r.v));
      if (scoreOnly) continue;
      if (matchId) g.statusMatchIds.add(matchId);
    }
    g.topics.add(topic);
  }
  return [...out.values()];
}

export function changedPayload(
  g: CompetitionChanges,
  over: Partial<Pick<LiveChangedPayload, 'matIds' | 'matchIds' | 'topics'>> = {},
): LiveChangedPayload {
  return {
    topics: over.topics ?? [...g.topics],
    categoryIds: [...g.categoryIds],
    matIds: over.matIds ?? [...g.matIds],
    matchIds: over.matchIds ?? [...g.matchIds],
  };
}
