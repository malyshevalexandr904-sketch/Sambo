// Расписание турнира (API.md, 6.2; ARCHITECTURE.md, 14.6, 16.6; DATABASE.md, 3.7; Phase 6).
// Автопланировщик — чистая функция (apps/api scheduling/domain); здесь — вход и результат команд по сети.
import { z } from 'zod';
import { Instant, type LocalizedText, Uuid } from './common.js';
import { type MatchStatus, type UserRef } from './draws.js';

// ---------- Ковры ----------

export const MatInput = z.object({
  number: z.number().int().min(1).max(200),
  name: z.string().trim().min(1).max(60).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type MatInput = z.infer<typeof MatInput>;

export const MatPatch = z.object({
  number: z.number().int().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(60).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type MatPatch = z.infer<typeof MatPatch>;

export interface MatDto {
  id: string;
  competitionId: string;
  number: number;
  name: string | null;
  isActive: boolean;
  version: number;
  allowedActions: string[];
}

// ---------- Сессии ----------

// Названия с префиксом Schedule- (не Session-): SessionDto уже занято веб-сессией входа (auth.ts).
export const ScheduleSessionInput = z
  .object({ name: z.string().trim().min(1).max(60), startsAt: Instant, endsAt: Instant })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    error: 'range_invalid',
    path: ['endsAt'],
  });
export type ScheduleSessionInput = z.infer<typeof ScheduleSessionInput>;

export const ScheduleSessionPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  startsAt: Instant.optional(),
  endsAt: Instant.optional(),
});
export type ScheduleSessionPatch = z.infer<typeof ScheduleSessionPatch>;

export interface ScheduleSessionDto {
  id: string;
  competitionId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  version: number;
  allowedActions: string[];
}

// ---------- Генерация ----------

export const ScheduleGenerate = z.object({
  /** Какие сессии заполняет этот прогон; не указано — все сессии турнира. */
  sessionIds: z.array(Uuid).max(200).optional(),
  /** Закрепление категории за ковром на этот прогон (не хранится отдельно — см. domain/types.ts). */
  categoryPins: z
    .array(z.object({ categoryId: Uuid, matId: Uuid }))
    .max(500)
    .default([]),
  /** Финалы и схватки за 3-е место общим блоком в конце дня (по умолчанию — да). */
  finalsBlock: z.boolean().default(true),
});
export type ScheduleGenerate = z.infer<typeof ScheduleGenerate>;

// ---------- Ручная правка ----------

export const ScheduleItemMove = z.object({
  matchId: Uuid,
  sessionId: Uuid,
  matId: Uuid,
  orderInMat: z.number().int().min(1).max(999),
  /** «Закрепить» — не указано, состояние не меняется. */
  locked: z.boolean().optional(),
});
export type ScheduleItemMove = z.infer<typeof ScheduleItemMove>;

export const ScheduleItemsPatch = z.object({
  moves: z.array(ScheduleItemMove).min(1).max(500),
  /** Пакет содержит только предупреждения (не запреты) — сохранить его всё равно можно только с confirm: true. */
  confirm: z.boolean().default(false),
});
export type ScheduleItemsPatch = z.infer<typeof ScheduleItemsPatch>;

// ---------- Ответы ----------

export const SCHEDULE_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface ScheduleParticipantDto {
  entryId: string | null;
  publicName: string | null;
  bye: boolean;
}

export interface ScheduleMatchDto {
  matchId: string;
  matchNumber: number | null;
  publicId: string;
  categoryId: string;
  categoryName: LocalizedText;
  roundLabel: string;
  red: ScheduleParticipantDto;
  blue: ScheduleParticipantDto;
  status: MatchStatus;
  durationSeconds: number;
  sessionId: string;
  matId: string;
  orderInMat: number;
  plannedAt: string;
  endsAt: string;
  locked: boolean;
  /**
   * Утешительная схватка узла, чей соперник выбыл после публикации сетки (продвижение решило узел без схватки):
   * слот в расписании сохраняется, но схватка помечается «без схватки» и пропускается в очереди ковра.
   */
  noMatch: boolean;
}

export const SCHEDULE_WARNING_KINDS = ['rest_dependency', 'rest_athlete', 'session_overflow'] as const;
export type ScheduleWarningKind = (typeof SCHEDULE_WARNING_KINDS)[number];

export interface ScheduleWarningDto {
  matchId: string;
  kind: ScheduleWarningKind;
  shortfallSeconds: number;
}

export const UNASSIGNED_REASONS = ['no_active_mats', 'no_session_capacity'] as const;
export type UnassignedReason = (typeof UNASSIGNED_REASONS)[number];

export interface UnassignedMatchDto {
  matchId: string;
  matchNumber: number | null;
  categoryId: string;
  categoryName: LocalizedText;
  roundLabel: string;
  reason: UnassignedReason;
}

export interface MatLoadDto {
  matId: string;
  totalSeconds: number;
  /** Суммарная длина сессий турнира — для сравнения «загрузка ковра vs вместимость» на экране расписания. */
  capacitySeconds: number;
}

export interface ScheduleDto {
  competitionId: string;
  status: ScheduleStatus;
  matChangeoverSeconds: number;
  version: number;
  publishedAt: string | null;
  publishedBy: UserRef | null;
  items: ScheduleMatchDto[];
  unassigned: UnassignedMatchDto[];
  warnings: ScheduleWarningDto[];
  matLoad: MatLoadDto[];
  allowedActions: string[];
}

/** Экран ковра (кворум «Ковры»): текущая и до трёх следующих схваток. */
export interface MatQueueDto {
  matId: string;
  matNumber: number;
  matName: string | null;
  current: ScheduleMatchDto | null;
  next: ScheduleMatchDto[];
}

// ---------- Судейские бригады ----------

export const MAT_CREW_ROLES = [
  'MAT_CHIEF',
  'REFEREE',
  'SIDE_JUDGE',
  'TECHNICAL_SECRETARY',
  'SCOREBOARD_OPERATOR',
  'TIMEKEEPER',
] as const;
export type MatCrewRole = (typeof MAT_CREW_ROLES)[number];

export interface MatAssignmentDto {
  id: string;
  sessionId: string;
  matId: string;
  role: MatCrewRole;
  user: UserRef;
  version: number;
}

export const MatAssignmentPut = z.object({
  sessionId: Uuid,
  matId: Uuid,
  assignments: z
    .array(z.object({ role: z.enum(MAT_CREW_ROLES), userId: Uuid.nullable() }))
    .max(MAT_CREW_ROLES.length)
    .refine((rows) => new Set(rows.map((r) => r.role)).size === rows.length, { error: 'duplicate_role' }),
});
export type MatAssignmentPut = z.infer<typeof MatAssignmentPut>;

export const MatAssignmentCopy = z.object({
  fromSessionId: Uuid,
  toSessionId: Uuid,
  /** Не указано — копируются бригады всех ковров сессии-источника. */
  matId: Uuid.optional(),
});
export type MatAssignmentCopy = z.infer<typeof MatAssignmentCopy>;

/** Персонал турнира, которого можно назначить в бригаду (D-07: судьи, гл. судья, секретари). */
export const CREW_CANDIDATE_ROLES = ['REFEREE', 'CHIEF_REFEREE', 'SECRETARY'] as const;
export type CrewCandidateRole = (typeof CREW_CANDIDATE_ROLES)[number];

export interface CrewCandidateDto {
  id: string;
  displayName: string;
  roleCode: CrewCandidateRole;
}

// Место участника заявки в опубликованном расписании (план §6/§8) — тип EntryScheduleMatch в registrations.ts,
// рядом с EntryDto, которое его несёт.
