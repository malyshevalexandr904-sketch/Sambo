// Схватки и судейство (API.md, 6.3; ARCHITECTURE.md, 14.6, 16.6; план Phase 7a): переходы схватки, журнал
// событий, предварительный и подтверждённый результат, неявка; планшет ковра и подтверждение результатов.
import { z } from 'zod';
import { Instant, type LocalizedText, Reason } from './common.js';
import type { CompetitionStatus } from './competitions.js';
import {
  type MatchResultStatus,
  type MatchStatus,
  type Side,
  SIDES,
  type UserRef,
  type WinMethod,
} from './draws.js';
import type { MedicalIncidentDto, MatchResultRevisionDto } from './results.js';
import type { MatchEventType, MatchState, ProposedOutcome } from './scoring.js';
import type { MatCrewRole } from './scheduling.js';

// ---------- Справочные значения ----------

/** Результат продвигает сетку только подтверждённым. */
export const CONFIRMED_RESULT_STATUSES: readonly MatchResultStatus[] = ['CONFIRMED', 'PUBLISHED', 'AMENDED'];

/** Переходы схватки по команде (план §1). Завершение — командой результата (`POST …/result`). */
export const MATCH_TRANSITION_TARGETS = [
  'SCHEDULED',
  'READY',
  'IN_PROGRESS',
  'PAUSED',
  'FINISHED',
  'POSTPONED',
  'CANCELLED',
] as const;
export type MatchTransitionTarget = (typeof MATCH_TRANSITION_TARGETS)[number];

/** Способы, которые вносит бригада: исходы борьбы и исходы без борьбы во время схватки. */
export const RESULT_METHODS = [
  'TOTAL_VICTORY',
  'SUPERIORITY',
  'POINTS',
  'DECISION',
  'DISQUALIFICATION',
  'WITHDRAWAL',
  'INJURY',
] as const satisfies readonly WinMethod[];
export type ResultMethod = (typeof RESULT_METHODS)[number];

/** Неявка по вызову: не явился один спортсмен или оба (оба считаются проигравшими). */
export const NO_SHOW_SIDES = ['RED', 'BLUE', 'BOTH'] as const;
export type NoShowSide = (typeof NO_SHOW_SIDES)[number];

/** Типы событий, которые записывает планшет; отмена — отдельной командой (`…/events/{eventId}/void`). */
export const MATCH_EVENT_INPUT_TYPES = [
  'CLOCK_STARTED',
  'CLOCK_STOPPED',
  'SCORE',
  'HOLD_STARTED',
  'HOLD_ENDED',
  'PENALTY',
] as const satisfies readonly MatchEventType[];

const Code = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, { error: 'invalid_code' });
const ClockMs = z.number().int().min(0).max(3_600_000);

// ---------- Запросы ----------

/** Перенос и отмена схватки (Phase 7b) — с причиной. */
export const MatchTransitionRequest = z
  .object({
    to: z.enum(MATCH_TRANSITION_TARGETS),
    reason: Reason.optional(),
  })
  .refine((v) => (v.to !== 'POSTPONED' && v.to !== 'CANCELLED') || v.reason !== undefined, {
    path: ['reason'],
    message: 'required',
  });
export type MatchTransitionRequest = z.infer<typeof MatchTransitionRequest>;

/**
 * Событие схватки (`Idempotency-Key` обязателен). `expectedSeq` — номер последнего события, которое видел планшет:
 * команда по устаревшему состоянию получает EXPECTED_SEQ_MISMATCH, повтор с тем же ключом не создаёт дубль.
 */
export const MatchEventCreate = z
  .object({
    expectedSeq: z.number().int().min(0),
    type: z.enum(MATCH_EVENT_INPUT_TYPES),
    side: z.enum(SIDES).optional(),
    actionCode: Code.optional(),
    /** HOLD_ENDED — длительность удержания, мс. */
    value: ClockMs.optional(),
    matchClockMs: ClockMs,
    deviceTime: Instant,
    deviceId: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    const needsSide = ['SCORE', 'PENALTY', 'HOLD_STARTED', 'HOLD_ENDED'].includes(v.type);
    if (needsSide && !v.side) ctx.addIssue({ code: 'custom', path: ['side'], message: 'required' });
    if (v.type === 'SCORE' && !v.actionCode)
      ctx.addIssue({ code: 'custom', path: ['actionCode'], message: 'required' });
    if (v.type === 'HOLD_ENDED' && v.value === undefined)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'required' });
  });
export type MatchEventCreate = z.infer<typeof MatchEventCreate>;

export const MatchEventVoid = z.object({
  expectedSeq: z.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
  matchClockMs: ClockMs.optional(),
  deviceTime: Instant.optional(),
  deviceId: z.string().trim().min(1).max(64).optional(),
});
export type MatchEventVoid = z.infer<typeof MatchEventVoid>;

/**
 * Предварительный результат (бригада ковра): схватка завершается, участники освобождаются. Исход, отличный от
 * предложенного сервером, — с причиной (REASON_REQUIRED). `expectedSeq` — счёт, на котором основан результат.
 */
export const MatchResultInput = z.object({
  expectedSeq: z.number().int().min(0),
  winnerSide: z.enum(SIDES),
  method: z.enum(RESULT_METHODS),
  methodDetail: Code.optional(),
  reason: Reason.optional(),
});
export type MatchResultInput = z.infer<typeof MatchResultInput>;

export const MatchNoShowRequest = z.object({
  side: z.enum(NO_SHOW_SIDES),
  reason: Reason.optional(),
});
export type MatchNoShowRequest = z.infer<typeof MatchNoShowRequest>;

export const MatchEventsQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
});
export type MatchEventsQuery = z.infer<typeof MatchEventsQuery>;

// ---------- Ответы ----------

export interface MatchSideDto {
  entryId: string | null;
  bye: boolean;
  /** «Фамилия И.» (Q-04). */
  publicName: string | null;
  club: string | null;
  region: string | null;
  /** Участник снят после жеребьёвки: проигрывает оставшиеся схватки неявкой автоматически. */
  withdrawn: boolean;
}

/** Правила турнира для кнопок планшета (часть закреплённой версии правил). */
export interface MatchRulesDto {
  actions: { code: string; points: number | null; totalVictory: boolean }[];
  penalties: { code: string; opponentPoints: number | null; disqualification: boolean }[];
  hold: { thresholds: { seconds: number; points: number }[]; maxPerMatch: number };
  superiorityPoints: number;
  tieBreakers: string[];
}

export interface MatchResultDto {
  status: MatchResultStatus;
  winnerSide: Side | null;
  method: WinMethod;
  methodDetail: string | null;
  redScore: number | null;
  blueScore: number | null;
  durationMs: number | null;
  basedOnSeq: number | null;
  /** Причина исхода, отличного от предложенного, или неявки. */
  reason: string | null;
  /** Исход записан системой (BYE, неявка снятого участника), без судьи. */
  system: boolean;
  proposedBy: UserRef | null;
  proposedAt: string | null;
  confirmedBy: UserRef | null;
  confirmedAt: string | null;
}

export interface MatchMatRef {
  id: string;
  number: number;
  name: string | null;
}

/**
 * Действия над схваткой, доступные пользователю сейчас (права, назначение на ковёр и состояние):
 * `transition:READY` (вызов), `transition:SCHEDULED` (отмена вызова), `transition:IN_PROGRESS` (старт или
 * продолжение), `transition:PAUSED`, `event.create`, `event.void`, `result.record`, `result.confirm`, `no_show`.
 */
export type MatchAction =
  | 'transition:READY'
  | 'transition:SCHEDULED'
  | 'transition:IN_PROGRESS'
  | 'transition:PAUSED'
  | 'transition:POSTPONED'
  | 'transition:CANCELLED'
  | 'event.create'
  | 'event.void'
  | 'result.record'
  | 'result.confirm'
  | 'result.amend'
  | 'medical.record'
  | 'no_show'
  | 'protocol';

export interface MatchDetailDto {
  id: string;
  publicId: string;
  competitionId: string;
  categoryId: string;
  categoryName: LocalizedText;
  number: number | null;
  roundLabel: string;
  status: MatchStatus;
  durationSeconds: number | null;
  /** Фактический ковёр (после старта) или ковёр по расписанию. */
  mat: MatchMatRef | null;
  sessionId: string | null;
  plannedAt: string | null;
  readyAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  red: MatchSideDto;
  blue: MatchSideDto;
  /** Проекция счёта по журналу; до старта — null. */
  state: MatchState | null;
  seq: number;
  result: MatchResultDto | null;
  proposedOutcome: ProposedOutcome | null;
  rules: MatchRulesDto;
  /** Схватка вне сетки (создана вручную): на места не влияет. */
  manual: boolean;
  /** Прежние варианты изменённого результата (Phase 7b). */
  revisions: MatchResultRevisionDto[];
  /** Врач на ковре; заметка — только медицинскому персоналу. */
  incidents: MedicalIncidentDto[];
  version: number;
  allowedActions: MatchAction[];
}

export interface MatchEventDto {
  id: string;
  seq: number;
  type: MatchEventType;
  side: Side | null;
  actionCode: string | null;
  value: number | null;
  matchClockMs: number;
  deviceTime: string;
  serverTime: string;
  voidsEventId: string | null;
  /** Устройство (вкладка планшета), записавшее событие: по нему планшет сводит время чужого устройства к своему. */
  deviceId: string | null;
  /** Событие отменено (компенсирующим событием или вместе со своей половиной удержания). */
  voided: boolean;
  reason: string | null;
  recordedBy: UserRef | null;
}

export interface MatchEventsDto {
  matchId: string;
  seq: number;
  events: MatchEventDto[];
}

/** Ответ на событие: записанное событие и новый счёт. */
export interface MatchEventResultDto {
  event: MatchEventDto;
  seq: number;
  state: MatchState;
  proposedOutcome: ProposedOutcome | null;
}

/** Схватка кратко — для списков планшета, подтверждения и экрана «Ковры». */
export interface MatchBriefDto {
  id: string;
  number: number | null;
  categoryName: LocalizedText;
  roundLabel: string;
  status: MatchStatus;
  red: { publicName: string | null; club: string | null; bye: boolean };
  blue: { publicName: string | null; club: string | null; bye: boolean };
  mat: MatchMatRef | null;
  plannedAt: string | null;
  result: MatchResultDto | null;
  version: number;
}

export interface PendingConfirmationDto extends MatchBriefDto {
  /** Пользователь может подтвердить (главный судья — любые, руководитель ковра — своего ковра и сессии). */
  canConfirm: boolean;
}

export interface OfficiatingSessionDto {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface OfficiatingMatDto {
  id: string;
  number: number;
  name: string | null;
  isActive: boolean;
  /** Мои должности в бригаде этого ковра в текущей сессии. */
  myRoles: MatCrewRole[];
  current: MatchBriefDto | null;
  awaitingConfirmation: number;
}

/** Раздел «Судейство»: ковры турнира текущей сессии (свои — сверху) и схватки, ждущие подтверждения. */
export interface OfficiatingDto {
  competition: { id: string; name: string; timezone: string; status: CompetitionStatus };
  sessions: OfficiatingSessionDto[];
  currentSessionId: string | null;
  mats: OfficiatingMatDto[];
  pendingConfirmations: number;
  /** Может добавить схватку вручную (`match.create`, Phase 7b). */
  canCreateMatch: boolean;
}

/** Планшет ковра: текущая схватка целиком, следующая и ждущие подтверждения. */
export interface MatConsoleDto {
  competition: { id: string; name: string; timezone: string; status: CompetitionStatus };
  mat: MatchMatRef;
  session: OfficiatingSessionDto | null;
  myRoles: MatCrewRole[];
  current: MatchDetailDto | null;
  next: MatchBriefDto | null;
  awaitingConfirmation: PendingConfirmationDto[];
  serverTime: string;
}
