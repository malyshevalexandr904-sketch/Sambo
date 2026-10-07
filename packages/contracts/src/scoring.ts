// Счёт схватки (ARCHITECTURE.md, 14.6; план Phase 7, §2): чистая функция журнала событий и правил турнира —
// тот же журнал и те же правила дают тот же счёт. Все числа — из правил (RuleSetParametersV1): ценность действий,
// пороги и лимит удержаний, наказания по порядку и баллы сопернику, преимущество, тай-брейки. Код общий для API
// (счёт по журналу — источник истины) и планшета ковра (предпросмотр счёта, пока команды ещё не отправлены).
import type { Side, WinMethod } from './draws.js';
import type { RuleSetParametersV1, TieBreaker } from './rulesets.js';

export const MATCH_EVENT_TYPES = [
  'CLOCK_STARTED',
  'CLOCK_STOPPED',
  'SCORE',
  'HOLD_STARTED',
  'HOLD_ENDED',
  'PENALTY',
  'EVENT_VOIDED',
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

/** События, которые можно отменить компенсирующим событием: оценки, наказания и удержания (показания времени — нет). */
export const VOIDABLE_EVENT_TYPES: readonly MatchEventType[] = [
  'SCORE',
  'PENALTY',
  'HOLD_STARTED',
  'HOLD_ENDED',
];

/** Правила, от которых зависит счёт (часть версии правил турнира). */
export type ScoringRules = Pick<
  RuleSetParametersV1,
  'actions' | 'hold' | 'penalties' | 'superiorityPoints' | 'tieBreakers'
>;

/** Событие журнала в объёме, нужном для счёта. `seq` — порядковый номер в схватке (1, 2, …). */
export interface ScoringEvent {
  id: string;
  seq: number;
  type: MatchEventType;
  side: Side | null;
  actionCode: string | null;
  /** HOLD_ENDED — длительность удержания в миллисекундах по секундомеру планшета. */
  value: number | null;
  /** Показание основного секундомера схватки на устройстве (прошедшее время, мс). */
  matchClockMs: number;
  /** Время устройства в момент события (ISO). */
  deviceTime: string;
  /** EVENT_VOIDED — отменяемое событие. */
  voidsEventId: string | null;
}

export interface SideScore {
  /** Баллы: технические оценки и баллы за наказания соперника. */
  points: number;
  /** Наказания по порядку (коды правил). */
  penalties: string[];
  /** Удержания, принёсшие баллы (лимит — hold.maxPerMatch каждому спортсмену). */
  holds: number;
  /** Технические оценки по ценности: «4» → число оценок в 4 балла (тай-брейк «больше высших оценок»). */
  technical: Record<string, number>;
}

/** Основной секундомер: значение и момент последнего показания (табло досчитывает идущее время само). */
export interface ClockState {
  running: boolean;
  elapsedMs: number;
  /** Время устройства последнего показания (ISO) или null — секундомер ещё не запускали. */
  at: string | null;
}

export interface HoldState {
  side: Side;
  /** Время устройства начала удержания (ISO). */
  startedAt: string;
  /** Показание основного секундомера при начале удержания. */
  clockMs: number;
  eventId: string;
}

export type DecisiveKind = 'TOTAL_VICTORY' | 'SUPERIORITY' | 'DISQUALIFICATION';

export interface MatchState {
  /** Номер последнего события журнала (включая отмены); 0 — событий нет. */
  seq: number;
  durationMs: number;
  red: SideScore;
  blue: SideScore;
  clock: ClockState;
  hold: HoldState | null;
  /** Сторона последнего технического действия (оценка, удержание с баллами) — тай-брейк. */
  lastTechnical: Side | null;
  /** Досрочный исход: чистая победа, преимущество, дисквалификация. */
  decision: { kind: DecisiveKind; winner: Side; detail: string | null } | null;
}

/** Почему событие отклонено (EVENT_NOT_ALLOWED_BY_RULESET, details.reason). */
export const SCORING_REJECTIONS = [
  'side_required',
  'unknown_action',
  'unknown_penalty',
  'penalties_exhausted',
  'penalty_out_of_order',
  'value_required',
  'hold_active',
  'hold_not_active',
  'hold_limit_reached',
  'clock_running',
  'clock_not_running',
  'clock_not_monotonic',
  'time_expired',
  'match_decided',
  'not_voidable',
  'already_voided',
  'event_not_found',
] as const;
export type ScoringRejection = (typeof SCORING_REJECTIONS)[number];

export type ApplyResult = { ok: true; state: MatchState } | { ok: false; reason: ScoringRejection };

/** Основание предложенного исхода. */
export const OUTCOME_BASES = [
  'TOTAL_VICTORY',
  'SUPERIORITY',
  'DISQUALIFICATION',
  'POINTS',
  'TIE_BREAKER',
  'REFEREE_DECISION',
] as const;
export type OutcomeBasis = (typeof OUTCOME_BASES)[number];

/**
 * Исход, который сервер предлагает судье (план Phase 7, §3). `winnerSide: null` — решают судьи (тай-брейк
 * «решение судей» или все тай-брейки не определили победителя): судья выбирает победителя способом DECISION.
 */
export interface ProposedOutcome {
  winnerSide: Side | null;
  method: WinMethod;
  /** Код действия (чистая победа), наказания (дисквалификация) или тай-брейка. */
  methodDetail: string | null;
  basis: OutcomeBasis;
}

const other = (side: Side): Side => (side === 'RED' ? 'BLUE' : 'RED');

const emptySide = (): SideScore => ({ points: 0, penalties: [], holds: 0, technical: {} });

export function initialMatchState(durationMs: number): MatchState {
  return {
    seq: 0,
    durationMs,
    red: emptySide(),
    blue: emptySide(),
    clock: { running: false, elapsedMs: 0, at: null },
    hold: null,
    lastTechnical: null,
    decision: null,
  };
}

function cloneState(s: MatchState): MatchState {
  const side = (x: SideScore): SideScore => ({
    points: x.points,
    penalties: [...x.penalties],
    holds: x.holds,
    technical: { ...x.technical },
  });
  return {
    ...s,
    red: side(s.red),
    blue: side(s.blue),
    clock: { ...s.clock },
    hold: s.hold ? { ...s.hold } : null,
    decision: s.decision ? { ...s.decision } : null,
  };
}

const sideScore = (s: MatchState, side: Side): SideScore => (side === 'RED' ? s.red : s.blue);

/** Баллы удержания по порогам правил: наибольший достигнутый порог (не достиг первого — 0). */
export function holdPoints(rules: Pick<ScoringRules, 'hold'>, holdMs: number): number {
  let points = 0;
  for (const t of rules.hold.thresholds) if (holdMs >= t.seconds * 1000) points = Math.max(points, t.points);
  return points;
}

/** Преимущество: разница в баллах достигла порога правил — досрочная победа лидера. */
function checkSuperiority(s: MatchState, rules: ScoringRules): void {
  if (s.decision) return;
  const diff = s.red.points - s.blue.points;
  if (Math.abs(diff) >= rules.superiorityPoints)
    s.decision = { kind: 'SUPERIORITY', winner: diff > 0 ? 'RED' : 'BLUE', detail: null };
}

function addTechnical(s: MatchState, side: Side, points: number): void {
  const x = sideScore(s, side);
  x.points += points;
  x.technical[String(points)] = (x.technical[String(points)] ?? 0) + 1;
  s.lastTechnical = side;
}

const fail = (reason: ScoringRejection): ApplyResult => ({ ok: false, reason });

/**
 * Применение одного события к состоянию. `strict` — проверка новой команды (код наказания должен совпадать со
 * следующим по порядку); при повторе журнала (`strict: false`) наказание берётся следующим по порядку, а
 * событие, ставшее неприменимым после отмены более раннего, пропускается — так счёт всегда равен журналу.
 */
export function applyEvent(
  state: MatchState,
  e: ScoringEvent,
  rules: ScoringRules,
  strict = true,
): ApplyResult {
  const s = cloneState(state);
  s.seq = Math.max(s.seq, e.seq);
  switch (e.type) {
    case 'CLOCK_STARTED': {
      if (s.clock.running) return fail('clock_running');
      if (e.matchClockMs < s.clock.elapsedMs) return fail('clock_not_monotonic');
      if (s.clock.elapsedMs >= s.durationMs) return fail('time_expired');
      s.clock = { running: true, elapsedMs: Math.min(e.matchClockMs, s.durationMs), at: e.deviceTime };
      return { ok: true, state: s };
    }
    case 'CLOCK_STOPPED': {
      if (!s.clock.running) return fail('clock_not_running');
      if (e.matchClockMs < s.clock.elapsedMs) return fail('clock_not_monotonic');
      s.clock = { running: false, elapsedMs: Math.min(e.matchClockMs, s.durationMs), at: e.deviceTime };
      return { ok: true, state: s };
    }
    case 'SCORE': {
      if (!e.side) return fail('side_required');
      const action = rules.actions.find((a) => a.code === e.actionCode);
      if (!action) return fail('unknown_action');
      if (s.decision) return fail('match_decided');
      if (action.kind === 'TOTAL_VICTORY') {
        s.decision = { kind: 'TOTAL_VICTORY', winner: e.side, detail: action.code };
        s.lastTechnical = e.side;
      } else {
        addTechnical(s, e.side, action.points ?? 0);
        checkSuperiority(s, rules);
      }
      return { ok: true, state: s };
    }
    case 'PENALTY': {
      if (!e.side) return fail('side_required');
      if (s.decision) return fail('match_decided');
      const own = sideScore(s, e.side);
      const next = rules.penalties[own.penalties.length];
      if (!next) return fail('penalties_exhausted');
      if (strict && e.actionCode && e.actionCode !== next.code)
        return fail(
          rules.penalties.some((p) => p.code === e.actionCode) ? 'penalty_out_of_order' : 'unknown_penalty',
        );
      own.penalties.push(next.code);
      if (next.kind === 'DISQUALIFICATION') {
        s.decision = { kind: 'DISQUALIFICATION', winner: other(e.side), detail: next.code };
      } else {
        sideScore(s, other(e.side)).points += next.opponentPoints ?? 0;
        checkSuperiority(s, rules);
      }
      return { ok: true, state: s };
    }
    case 'HOLD_STARTED': {
      if (!e.side) return fail('side_required');
      if (s.decision) return fail('match_decided');
      if (s.hold) return fail('hold_active');
      if (!s.clock.running) return fail('clock_not_running');
      if (sideScore(s, e.side).holds >= rules.hold.maxPerMatch) return fail('hold_limit_reached');
      s.hold = { side: e.side, startedAt: e.deviceTime, clockMs: e.matchClockMs, eventId: e.id };
      return { ok: true, state: s };
    }
    case 'HOLD_ENDED': {
      if (!e.side) return fail('side_required');
      if (!s.hold || s.hold.side !== e.side) return fail('hold_not_active');
      if (e.value === null || e.value < 0) return fail('value_required');
      s.hold = null;
      const points = holdPoints(rules, e.value);
      if (points > 0) {
        addTechnical(s, e.side, points);
        sideScore(s, e.side).holds += 1;
        checkSuperiority(s, rules);
      }
      return { ok: true, state: s };
    }
    case 'EVENT_VOIDED':
      // Отмена учитывается повтором журнала (replayEvents): само событие счёт не меняет.
      return { ok: true, state: s };
  }
}

/**
 * События, исключённые из счёта: отменённые и вторая половина отменённого удержания (отмена начала или конца
 * удержания отменяет удержание целиком). Пара удержания — первое окончание той же стороны после начала.
 */
export function excludedEventIds(events: readonly ScoringEvent[]): Set<string> {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const voided = new Set(
    sorted.filter((e) => e.type === 'EVENT_VOIDED' && e.voidsEventId).map((e) => e.voidsEventId as string),
  );
  const pairOf = new Map<string, string>();
  let open: ScoringEvent | null = null;
  for (const e of sorted) {
    if (e.type === 'HOLD_STARTED') open = e;
    else if (e.type === 'HOLD_ENDED' && open && open.side === e.side) {
      pairOf.set(open.id, e.id);
      pairOf.set(e.id, open.id);
      open = null;
    }
  }
  const excluded = new Set(voided);
  for (const id of voided) {
    const pair = pairOf.get(id);
    if (pair) excluded.add(pair);
  }
  return excluded;
}

/** Счёт по журналу: события по порядку, без отменённых; неприменимые после отмены — пропускаются. */
export function replayEvents(
  events: readonly ScoringEvent[],
  rules: ScoringRules,
  durationMs: number,
): MatchState {
  const excluded = excludedEventIds(events);
  let state = initialMatchState(durationMs);
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'EVENT_VOIDED' || excluded.has(e.id)) {
      state = { ...state, seq: Math.max(state.seq, e.seq) };
      continue;
    }
    const r = applyEvent(state, e, rules, false);
    state = r.ok ? r.state : { ...state, seq: Math.max(state.seq, e.seq) };
  }
  return state;
}

/** Можно ли отменить событие журнала (до записи компенсирующего события). */
export function voidRejection(events: readonly ScoringEvent[], targetId: string): ScoringRejection | null {
  const target = events.find((e) => e.id === targetId);
  if (!target) return 'event_not_found';
  if (!VOIDABLE_EVENT_TYPES.includes(target.type)) return 'not_voidable';
  if (excludedEventIds(events).has(targetId)) return 'already_voided';
  return null;
}

/** Последнее событие, которое отменит кнопка «Отменить последнее»: оценка, наказание или удержание. */
export function lastVoidableEvent(events: readonly ScoringEvent[]): ScoringEvent | null {
  const excluded = excludedEventIds(events);
  const candidates = [...events]
    .sort((a, b) => b.seq - a.seq)
    .filter((e) => VOIDABLE_EVENT_TYPES.includes(e.type) && !excluded.has(e.id));
  return candidates[0] ?? null;
}

/** Основное время вышло: секундомер остановлен на длительности схватки. */
export const timeExpired = (s: MatchState): boolean => !s.clock.running && s.clock.elapsedMs >= s.durationMs;

/** Векторы «больше высших оценок»: число оценок по ценности, от высшей к низшей. */
function compareHighScores(red: SideScore, blue: SideScore): number {
  const values = [...new Set([...Object.keys(red.technical), ...Object.keys(blue.technical)])]
    .map(Number)
    .sort((a, b) => b - a);
  for (const v of values) {
    const d = (red.technical[String(v)] ?? 0) - (blue.technical[String(v)] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function tieBreak(s: MatchState, tb: TieBreaker): ProposedOutcome | null {
  switch (tb) {
    case 'LAST_TECHNICAL_ACTION':
      return s.lastTechnical
        ? { winnerSide: s.lastTechnical, method: 'POINTS', methodDetail: tb, basis: 'TIE_BREAKER' }
        : null;
    case 'FEWER_PENALTIES': {
      const d = s.red.penalties.length - s.blue.penalties.length;
      return d === 0
        ? null
        : { winnerSide: d < 0 ? 'RED' : 'BLUE', method: 'POINTS', methodDetail: tb, basis: 'TIE_BREAKER' };
    }
    case 'MORE_HIGH_SCORES': {
      const d = compareHighScores(s.red, s.blue);
      return d === 0
        ? null
        : { winnerSide: d > 0 ? 'RED' : 'BLUE', method: 'POINTS', methodDetail: tb, basis: 'TIE_BREAKER' };
    }
    case 'REFEREE_DECISION':
      return { winnerSide: null, method: 'DECISION', methodDetail: tb, basis: 'REFEREE_DECISION' };
  }
}

/**
 * Предлагаемый исход (ARCHITECTURE.md, 14.6): досрочный исход — сразу; иначе только когда основное время вышло
 * и удержание не идёт: больше баллов, при равенстве — тай-брейки правил по порядку. Схватка продолжается — null.
 */
export function determineOutcome(
  s: MatchState,
  rules: Pick<ScoringRules, 'tieBreakers'>,
): ProposedOutcome | null {
  if (s.decision) {
    return {
      winnerSide: s.decision.winner,
      method: s.decision.kind,
      methodDetail: s.decision.detail,
      basis: s.decision.kind,
    };
  }
  if (s.hold || !timeExpired(s)) return null;
  if (s.red.points !== s.blue.points)
    return {
      winnerSide: s.red.points > s.blue.points ? 'RED' : 'BLUE',
      method: 'POINTS',
      methodDetail: null,
      basis: 'POINTS',
    };
  for (const tb of rules.tieBreakers) {
    const result = tieBreak(s, tb);
    if (result) return result;
  }
  return { winnerSide: null, method: 'DECISION', methodDetail: null, basis: 'REFEREE_DECISION' };
}

/** Текущее показание идущего секундомера: последнее показание + время с него (смещение часов — у клиента). */
export function clockNowMs(clock: ClockState, nowMs: number, durationMs: number): number {
  if (!clock.running || !clock.at) return clock.elapsedMs;
  return Math.min(durationMs, clock.elapsedMs + Math.max(0, nowMs - Date.parse(clock.at)));
}
