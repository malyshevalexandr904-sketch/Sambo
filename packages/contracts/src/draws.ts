// Жеребьёвка и сетки (API.md, 6.1; ARCHITECTURE.md, 14.4–14.5, 16.5; ADR-11; Phase 5a).
import { z } from 'zod';
import { Reason, Uuid } from './common.js';
import type { CategoryRef, CategoryWeight } from './competition-categories.js';
import type { CategoryStatus } from './competitions.js';
import { DRAW_FORMATS, type Pool, type RoundLabel } from './formats.js';
import type { Gender } from './people.js';
import type { EntryStatus } from './registrations.js';
import type { CompetitionFormatCode } from './rulesets.js';

// ---------- Справочные значения ----------

export const DRAW_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED'] as const;
export type DrawStatus = (typeof DRAW_STATUSES)[number];

/** Ключи разведения (приоритет — порядок в запросе): команда, за которую выступает спортсмен, и регион. */
export const SEPARATION_KEYS = ['ORGANIZATION', 'REGION'] as const;
export type SeparationKey = (typeof SEPARATION_KEYS)[number];

export const SIDES = ['RED', 'BLUE'] as const;
export type Side = (typeof SIDES)[number];

export const MATCH_STATUSES = [
  'SCHEDULED',
  'READY',
  'IN_PROGRESS',
  'PAUSED',
  'FINISHED',
  'POSTPONED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Способ победы (DATABASE.md, 3.6). Результаты схваток — Phase 7; здесь — для продвижения и мест. */
export const WIN_METHODS = [
  'TOTAL_VICTORY',
  'SUPERIORITY',
  'POINTS',
  'DECISION',
  'NO_SHOW',
  'WITHDRAWAL',
  'INJURY',
  'DISQUALIFICATION',
  'BYE',
] as const;
export type WinMethod = (typeof WIN_METHODS)[number];

/** PROVISIONAL — внесла бригада ковра; CONFIRMED — подтвердил руководитель ковра или главный судья (7b: PUBLISHED, AMENDED). */
export const MATCH_RESULT_STATUSES = ['PROVISIONAL', 'CONFIRMED', 'PUBLISHED', 'AMENDED'] as const;
export type MatchResultStatus = (typeof MATCH_RESULT_STATUSES)[number];

export const BRACKET_STAGES = ['MAIN', 'REPECHAGE', 'POOL'] as const;
export type BracketStage = (typeof BRACKET_STAGES)[number];

/** Источник стороны узла: позиция жеребьёвки, победитель или проигравший узла, правило формата. */
export const SLOT_SOURCES = ['DRAW_SLOT', 'WINNER_OF', 'LOSER_OF', 'POOL_RANK', 'DYNAMIC'] as const;
export type SlotSourceType = (typeof SLOT_SOURCES)[number];

/**
 * Состояние узла сетки: ждёт участников, готов (обе стороны известны), решён результатом, решён без схватки
 * (соперника нет — BYE), пуст (нет ни одного участника).
 */
export const NODE_STATUSES = ['PENDING', 'READY', 'DECIDED', 'WALKOVER', 'EMPTY'] as const;
export type BracketNodeStatus = (typeof NODE_STATUSES)[number];

// ---------- Запросы ----------

export const RandomSeed = z
  .string()
  .regex(/^[0-9a-f]{32}$/, { error: 'invalid_seed' })
  .refine((s) => !/^0+$/.test(s), { error: 'invalid_seed' });

export const DrawCreate = z.object({
  /** Без формата — по категории (formatOverride) или по правилам турнира (formatSelection). */
  format: z.enum(DRAW_FORMATS).optional(),
  seeding: z
    .array(z.object({ entryId: Uuid, seedNumber: z.number().int().min(1).max(256) }))
    .max(64)
    .default([]),
  separation: z
    .object({
      by: z
        .array(z.enum(SEPARATION_KEYS))
        .max(SEPARATION_KEYS.length)
        .refine((keys) => new Set(keys).size === keys.length, { error: 'duplicate_key' }),
    })
    .default({ by: ['ORGANIZATION', 'REGION'] }),
  /** 128 бит в hex. Без него сервер генерирует seed криптографическим генератором. */
  randomSeed: RandomSeed.optional(),
});
export type DrawCreate = z.infer<typeof DrawCreate>;

export const DrawSupersede = z.object({ reason: Reason });
export type DrawSupersede = z.infer<typeof DrawSupersede>;

// ---------- Ответы ----------

export interface NamedRef {
  id: string;
  name: string;
}

export interface DrawParticipantDto {
  entryId: string;
  /** «Фамилия И.» (Q-04). */
  publicName: string;
  birthYear: number;
  organization: NamedRef | null;
  region: NamedRef | null;
  seedNumber: number | null;
  /** Позиция в жеребьёвке и подгруппа. */
  position: number | null;
  pool: Pool | null;
  /** Участие снято после жеребьёвки — отмечается в сетке (неявка — Phase 7). */
  entryStatus: EntryStatus;
}

export interface DrawSlotDto {
  position: number;
  /** null — BYE. */
  entryId: string | null;
  seedNumber: number | null;
  pool: Pool | null;
}

export interface SeparationGroupDto {
  key: SeparationKey;
  value: string;
  name: string | null;
  size: number;
  idealRound: number;
  achievedRound: number;
}

export interface SeparationReportDto {
  applicable: boolean;
  keys: SeparationKey[];
  groups: SeparationGroupDto[];
  unmet: number;
}

export interface UserRef {
  id: string;
  displayName: string;
}

export interface DrawSummaryDto {
  id: string;
  categoryId: string;
  /** Номер версии жеребьёвки в категории. */
  number: number;
  status: DrawStatus;
  format: CompetitionFormatCode;
  participants: number;
  /** Вход черновика разошёлся с текущими допущенными участниками: публикация невозможна. */
  stale: boolean;
  /** seed задан вручную, а не создан сервером. */
  manualSeed: boolean;
  createdAt: string;
  publishedAt: string | null;
  supersededAt: string | null;
  version: number;
  allowedActions: string[];
}

export interface BracketSideDto {
  entryId: string | null;
  bye: boolean;
  source: { type: SlotSourceType; ref: string };
}

export interface BracketMatchDto {
  id: string;
  publicId: string;
  /** Номер схватки; у схватки без соперника (BYE) номера нет. */
  number: number | null;
  status: MatchStatus;
  winnerSide: Side | null;
  durationSeconds: number | null;
  /** Результат схватки (Phase 7a): способ, счёт, предварительный или подтверждённый. */
  result: {
    status: MatchResultStatus;
    winnerSide: Side | null;
    method: WinMethod;
    redScore: number | null;
    blueScore: number | null;
  } | null;
}

export interface BracketNodeDto {
  key: string;
  stage: BracketStage;
  round: number;
  position: number;
  label: RoundLabel;
  placeForWinner: number | null;
  placeForLoser: number | null;
  red: BracketSideDto;
  blue: BracketSideDto;
  winnerTo: { key: string; side: Side } | null;
  status: BracketNodeStatus;
  winnerSide: Side | null;
  /** Схватка опубликованной сетки; в предпросмотре черновика — null. */
  match: BracketMatchDto | null;
}

export interface BracketViewDto {
  format: CompetitionFormatCode;
  size: number;
  nodes: BracketNodeDto[];
  participants: DrawParticipantDto[];
}

export interface DrawDto extends DrawSummaryDto {
  competitionId: string;
  algorithmVersion: string;
  randomSeed: string;
  inputHash: string;
  separation: SeparationReportDto;
  slots: DrawSlotDto[];
  createdBy: UserRef | null;
  publishedBy: UserRef | null;
  supersededBy: UserRef | null;
  supersedeReason: string | null;
  /** Сетка по слотам этой версии: для черновика — предпросмотр без схваток. */
  bracket: BracketViewDto;
}

export interface DrawVerifyDto {
  /** Повтор по seed и сохранённому входу дал ту же расстановку. */
  reproducible: boolean;
  inputHashMatches: boolean;
  slotsMatch: boolean;
  /** Вход совпадает с текущими допущенными участниками категории. */
  currentInput: boolean;
  algorithmVersion: string;
}

export interface DrawCategoryDto extends CategoryRef {
  status: CategoryStatus;
  gender: Gender;
  weight: CategoryWeight;
  formatOverride: CompetitionFormatCode | null;
  sortOrder: number;
}

/** Жеребьёвка категории: готовность, предлагаемый формат, версии. */
export interface CategoryDrawsDto {
  category: DrawCategoryDto;
  /** Одобренные участия с допуском ADMITTED — участники жеребьёвки. */
  admitted: number;
  /** Одобренные участия, допуск которых ещё не решён. */
  admissionPending: number;
  suggestedFormat: CompetitionFormatCode | null;
  /** Допущенные участники (для посева в черновике): без позиции. */
  participants: DrawParticipantDto[];
  draws: DrawSummaryDto[];
  allowedActions: string[];
}

/** Обзор жеребьёвки турнира: строка на категорию. */
export interface DrawOverviewRow {
  category: DrawCategoryDto;
  admitted: number;
  admissionPending: number;
  suggestedFormat: CompetitionFormatCode | null;
  published: DrawSummaryDto | null;
  drafts: number;
}

/** Сетка категории по опубликованной жеребьёвке. */
export interface CategoryBracketDto {
  category: DrawCategoryDto;
  draw: DrawSummaryDto | null;
  bracket: BracketViewDto | null;
}
