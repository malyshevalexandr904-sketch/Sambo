// Общие типы планировщика расписания (Phase 6; ARCHITECTURE.md, 14.6). Время — целые секунды эпохи (не Date):
// чистые функции детерминированы и не зависят от часового пояса, приложение переводит в Date на границе.

export interface SessionInput {
  id: string;
  startsAt: number;
  endsAt: number;
}

export interface MatInput {
  id: string;
  number: number;
}

export interface CategoryInput {
  id: string;
  /** Порядок вкладки «Категории»: меньше — раньше. */
  sortOrder: number;
  /** Закрепление за ковром на эту генерацию (параметр запроса, не хранится отдельно). */
  pinnedMatId?: string | null;
}

/** Место схватки, которое генерация не трогает (ручное «Закрепить» или уже опубликованная часть расписания). */
export interface PinnedPlacement {
  sessionId: string;
  matId: string;
  orderInMat: number;
}

export interface MatchInput {
  id: string;
  categoryId: string;
  /** Порядок внутри категории (brackets.numberingOrder): круги основной сетки, затем утешительные, затем финал. */
  orderInCategory: number;
  durationSeconds: number;
  /** Схватки, которые должны закончиться раньше (участники этой схватки зависят от их исхода). */
  dependsOn: readonly string[];
  /** Известные сейчас участники (0–2 id спортсмена): контроль отдыха и «не в двух местах одновременно». */
  athleteIds: readonly string[];
  /** Финал или схватка за 3-е место: при blockFinals переносится в конец дня (раздел 6, блок финалов). */
  isFinalsBlock: boolean;
  pinned?: PinnedPlacement;
}

export interface PlacedMatch {
  matchId: string;
  sessionId: string;
  matId: string;
  orderInMat: number;
  /** Эпоха, секунды. */
  plannedAt: number;
  endsAt: number;
}

export type UnassignedReason = 'no_active_mats' | 'no_session_capacity';

export interface UnassignedMatch {
  matchId: string;
  categoryId: string;
  reason: UnassignedReason;
}

export type WarningKind = 'rest_dependency' | 'rest_athlete' | 'session_overflow';

export interface ScheduleWarning {
  matchId: string;
  kind: WarningKind;
  /** Секунд не хватает до нормы (отдых) или секунд превышения окна сессии. */
  shortfallSeconds: number;
}

export interface MatLoad {
  matId: string;
  totalSeconds: number;
}
