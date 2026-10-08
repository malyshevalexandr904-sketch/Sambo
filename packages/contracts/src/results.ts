// Итоги (план Phase 7b): места и медали категории, публикация результатов, история спортсмена, изменение
// подтверждённого результата, врач на ковре, ручная схватка, печатные протоколы.
import { z } from 'zod';
import { type LocalizedText, Reason, Uuid } from './common.js';
import type { CategoryStatus, CompetitionLevel, CompetitionStatus } from './competitions.js';
import {
  type MatchResultStatus,
  type Side,
  SIDES,
  type UserRef,
  WIN_METHODS,
  type WinMethod,
} from './draws.js';
import type { CompetitionFormatCode } from './rulesets.js';

// ---------- Места и медали ----------

export const MEDALS = ['GOLD', 'SILVER', 'BRONZE'] as const;
export type Medal = (typeof MEDALS)[number];

/** Медаль за место: 1 — золото, 2 — серебро, 3 — бронза (в выбывании — две бронзы); ниже — без медали. */
export function medalForPlace(place: number): Medal | null {
  return place === 1 ? 'GOLD' : place === 2 ? 'SILVER' : place === 3 ? 'BRONZE' : null;
}

/** Итоги категории: посчитаны (PROVISIONAL), опубликованы, изменены после публикации. */
export const CATEGORY_RESULT_STATUSES = ['PROVISIONAL', 'PUBLISHED', 'AMENDED'] as const;
export type CategoryResultStatus = (typeof CATEGORY_RESULT_STATUSES)[number];

export interface PlacementDto {
  entryId: string;
  place: number;
  medal: Medal | null;
  wins: number;
  losses: number;
  /** «Фамилия И.» (Q-04). */
  publicName: string;
  club: string | null;
  region: string | null;
  withdrawn: boolean;
}

/** Итоги категории для экрана «Итоги»: места, сколько схваток осталось, можно ли опубликовать. */
export interface CategoryResultsDto {
  categoryId: string;
  competitionId: string;
  categoryName: LocalizedText;
  categoryStatus: CategoryStatus;
  format: CompetitionFormatCode | null;
  /** Итогов ещё нет (категория не завершена) — null. */
  status: CategoryResultStatus | null;
  computedAt: string | null;
  publishedAt: string | null;
  publishedBy: UserRef | null;
  amendedAt: string | null;
  /** Версия итогов (If-Match публикации); итогов нет — 0. */
  version: number;
  matchesTotal: number;
  matchesDecided: number;
  /** Сыграны, результат ждёт подтверждения. */
  awaitingConfirmation: number;
  placements: PlacementDto[];
  canPublish: boolean;
}

export interface CompetitionResultsDto {
  competition: { id: string; name: string; status: CompetitionStatus; timezone: string };
  categories: CategoryResultsDto[];
  /** Результаты всех категорий опубликованы — турнир можно завершить. */
  allPublished: boolean;
  canFinish: boolean;
}

// ---------- История спортсмена ----------

export interface AthleteResultDto {
  competitionId: string;
  competitionName: string;
  startDate: string;
  endDate: string;
  level: CompetitionLevel;
  categoryName: LocalizedText;
  clubName: string | null;
  place: number;
  medal: Medal | null;
  wins: number;
  losses: number;
  status: CategoryResultStatus;
  publishedAt: string;
}

export interface AthleteHistoryDto {
  athleteId: string;
  summary: {
    competitions: number;
    matches: number;
    wins: number;
    losses: number;
    medals: Record<Medal, number>;
  };
  results: AthleteResultDto[];
}

// ---------- Изменение подтверждённого результата ----------

/** Способы при изменении: все, кроме «без соперника» (схватка сыграна или решена неявкой). */
export const AMEND_METHODS = WIN_METHODS.filter((m) => m !== 'BYE') as Exclude<WinMethod, 'BYE'>[];

export const MatchResultAmend = z.object({
  winnerSide: z.enum(SIDES),
  method: z.enum(AMEND_METHODS as [Exclude<WinMethod, 'BYE'>, ...Exclude<WinMethod, 'BYE'>[]]),
  methodDetail: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, { error: 'invalid_code' })
    .optional(),
  redScore: z.number().int().min(0).max(999).optional(),
  blueScore: z.number().int().min(0).max(999).optional(),
  reason: Reason,
});
export type MatchResultAmend = z.infer<typeof MatchResultAmend>;

export interface MatchResultRevisionDto {
  /** Номер прежнего варианта (1 — первоначальный). */
  revision: number;
  status: MatchResultStatus;
  winnerSide: Side | null;
  method: WinMethod;
  methodDetail: string | null;
  redScore: number | null;
  blueScore: number | null;
  /** Почему вариант заменён. */
  reason: string;
  changedBy: UserRef | null;
  changedAt: string;
}

// ---------- Врач на ковре ----------

export const MEDICAL_INCIDENT_KINDS = ['ASSISTANCE', 'STOPPAGE'] as const;
export type MedicalIncidentKind = (typeof MEDICAL_INCIDENT_KINDS)[number];

export const MEDICAL_INCIDENT_DECISIONS = ['CONTINUE', 'WITHDRAWN_BY_DOCTOR'] as const;
export type MedicalIncidentDecision = (typeof MEDICAL_INCIDENT_DECISIONS)[number];

export const MedicalIncidentCreate = z
  .object({
    side: z.enum(SIDES),
    kind: z.enum(MEDICAL_INCIDENT_KINDS),
    decision: z.enum(MEDICAL_INCIDENT_DECISIONS),
    note: z.string().trim().max(1000).optional(),
    matchClockMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .refine((v) => v.kind === 'STOPPAGE' || v.decision === 'CONTINUE', {
    path: ['decision'],
    message: 'withdrawal_requires_stoppage',
  });
export type MedicalIncidentCreate = z.infer<typeof MedicalIncidentCreate>;

export interface MedicalIncidentDto {
  id: string;
  matchId: string;
  side: Side;
  entryId: string;
  kind: MedicalIncidentKind;
  decision: MedicalIncidentDecision;
  matchClockMs: number | null;
  recordedAt: string;
  recordedBy: UserRef | null;
  /** Заметка врача — только медицинскому персоналу; остальным — null. */
  note: string | null;
}

// ---------- Ручная схватка вне сетки ----------

/** Ручная схватка категории (`POST /categories/{id}/matches`). */
export const ManualMatchCreate = z
  .object({
    redEntryId: Uuid,
    blueEntryId: Uuid,
    /** Подпись круга (например, «Показательная», «Переигровка»). */
    label: z.string().trim().min(2).max(60),
    durationSeconds: z.number().int().min(30).max(900),
    matId: Uuid,
    sessionId: Uuid,
    reason: Reason.optional(),
  })
  .refine((v) => v.redEntryId !== v.blueEntryId, { path: ['blueEntryId'], message: 'same_participant' });
export type ManualMatchCreate = z.infer<typeof ManualMatchCreate>;

// ---------- Протоколы (печать из браузера, A4) ----------

export interface ProtocolHeader {
  competitionId: string;
  competitionName: string;
  organizerName: string | null;
  disciplineName: LocalizedText | null;
  startDate: string;
  endDate: string;
  timezone: string;
  generatedAt: string;
}

export interface ProtocolParticipant {
  entryId: string;
  /** Полное ФИО (служебный документ). */
  fullName: string;
  publicName: string;
  birthYear: number;
  rank: LocalizedText | null;
  club: string | null;
  region: string | null;
}

export interface ProtocolEventRow {
  seq: number;
  matchClockMs: number;
  type: string;
  side: Side | null;
  actionCode: string | null;
  /** Удержание — длительность, мс. */
  value: number | null;
  /** Баллы стороне действия или сопернику (наказание) — по правилам турнира. */
  points: number | null;
  pointsTo: Side | null;
  /** Счёт после события. */
  red: number;
  blue: number;
  voided: boolean;
  voidReason: string | null;
  voidedAtMs: number | null;
}

export interface MatchProtocolDto {
  header: ProtocolHeader;
  matchId: string;
  publicId: string;
  number: number | null;
  categoryName: LocalizedText;
  roundLabel: string;
  manual: boolean;
  mat: { number: number; name: string | null } | null;
  /** Длительность схватки: «Стоп» на ней — «время вышло». */
  durationSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  red: ProtocolParticipant | null;
  blue: ProtocolParticipant | null;
  events: ProtocolEventRow[];
  penalties: { red: string[]; blue: string[] };
  result: {
    status: MatchResultStatus;
    winnerSide: Side | null;
    method: WinMethod;
    methodDetail: string | null;
    redScore: number | null;
    blueScore: number | null;
    reason: string | null;
    proposedBy: UserRef | null;
    proposedAt: string | null;
    confirmedBy: UserRef | null;
    confirmedAt: string | null;
  } | null;
  revisions: MatchResultRevisionDto[];
  incidents: Omit<MedicalIncidentDto, 'note'>[];
  /** Подписи: судья и руководитель ковра — из бригады ковра в сессии схватки. */
  signatures: { referee: string | null; matChief: string | null };
}

export interface CategoryProtocolMatchRow {
  matchId: string;
  number: number | null;
  roundLabel: string;
  red: string | null;
  blue: string | null;
  redBye: boolean;
  blueBye: boolean;
  winnerSide: Side | null;
  method: WinMethod | null;
  methodDetail: string | null;
  redScore: number | null;
  blueScore: number | null;
  /** Схватка не проводилась (без соперника, пустая). */
  noMatch: boolean;
  amended: { at: string; previous: MatchResultRevisionDto; reason: string } | null;
}

export interface CategoryProtocolDto {
  header: ProtocolHeader;
  categoryId: string;
  categoryCode: string;
  categoryName: LocalizedText;
  format: CompetitionFormatCode | null;
  participants: number;
  resultStatus: CategoryResultStatus | null;
  publishedAt: string | null;
  places: (ProtocolParticipant & { place: number; medal: Medal | null; wins: number; losses: number })[];
  matches: CategoryProtocolMatchRow[];
  /** Подписи: главный судья и главный секретарь турнира (персонал с ролями CHIEF_REFEREE, SECRETARY). */
  signatures: { chiefReferee: string | null; chiefSecretary: string | null };
}

/** Время по секундомеру M:SS. */
export function formatMatchClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
