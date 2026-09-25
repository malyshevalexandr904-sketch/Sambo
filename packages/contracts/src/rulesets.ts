// Наборы правил и их версии (API.md, 4.5; DATABASE.md, 3.4; ADR-09). Правила — данные, а не код:
// длительности, действия, удержание, наказания, преимущество, тай-брейки, отдых, допуск по весу, форматы.
import { z } from 'zod';
import { Uuid } from './common.js';
import type { OrganizationRef } from './organizations.js';
import type { ProfileStatus } from './people.js';

export const COMPETITION_FORMAT_CODES = [
  'ROUND_ROBIN',
  'SINGLE_ELIMINATION',
  'ELIMINATION_WITH_REPECHAGE',
  'DOUBLE_ELIMINATION',
  'PENALTY_POINTS_ELIMINATION',
  'GROUP_STAGE',
  'GROUP_PLUS_PLAYOFF',
] as const;
export type CompetitionFormatCode = (typeof COMPETITION_FORMAT_CODES)[number];

export const TIE_BREAKERS = [
  'LAST_TECHNICAL_ACTION',
  'FEWER_PENALTIES',
  'MORE_HIGH_SCORES',
  'REFEREE_DECISION',
] as const;
export type TieBreaker = (typeof TIE_BREAKERS)[number];

const Code = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, { error: 'invalid_code' });
const Age = z.number().int().min(5).max(99);
const Seconds = z.number().int().min(30).max(900);

const uniqueCodes = (items: { code: string }[]): boolean =>
  new Set(items.map((i) => i.code)).size === items.length;

export const RuleSetParametersV1 = z
  .object({
    /** Длительность схватки по возрасту (включительно). */
    matchDuration: z
      .array(z.object({ ageFrom: Age, ageTo: Age, seconds: Seconds }))
      .min(1)
      .refine((rows) => rows.every((r) => r.ageFrom <= r.ageTo), { error: 'age_range_invalid' })
      .refine(
        (rows) => {
          const sorted = [...rows].sort((a, b) => a.ageFrom - b.ageFrom);
          return sorted.every((r, i) => i === 0 || r.ageFrom > (sorted[i - 1]?.ageTo ?? -1));
        },
        { error: 'age_ranges_overlap' },
      ),
    repechageMatchSeconds: Seconds.optional(),
    minRestSeconds: z.number().int().min(0).max(7200),
    weighInToleranceGrams: z.number().int().min(0).max(2000),
    actions: z
      .array(
        z
          .object({
            code: Code,
            points: z.number().int().min(1).max(20).optional(),
            kind: z.literal('TOTAL_VICTORY').optional(),
          })
          .refine((a) => (a.points === undefined) !== (a.kind === undefined), {
            error: 'points_or_kind_required',
          }),
      )
      .min(1)
      .refine(uniqueCodes, { error: 'duplicate_code' }),
    hold: z.object({
      thresholds: z
        .array(
          z.object({ seconds: z.number().int().min(1).max(120), points: z.number().int().min(1).max(20) }),
        )
        .min(1)
        .refine((t) => t.every((x, i) => i === 0 || x.seconds > (t[i - 1]?.seconds ?? 0)), {
          error: 'thresholds_not_ascending',
        }),
      maxPerMatch: z.number().int().min(0).max(10),
    }),
    penalties: z
      .array(
        z
          .object({
            code: Code,
            opponentPoints: z.number().int().min(0).max(20).optional(),
            kind: z.literal('DISQUALIFICATION').optional(),
          })
          .refine((p) => (p.opponentPoints === undefined) !== (p.kind === undefined), {
            error: 'points_or_kind_required',
          }),
      )
      .min(1)
      .refine(uniqueCodes, { error: 'duplicate_code' }),
    superiorityPoints: z.number().int().min(1).max(50),
    tieBreakers: z
      .array(z.enum(TIE_BREAKERS))
      .min(1)
      .refine((t) => new Set(t).size === t.length, { error: 'duplicate_code' }),
    /** Формат по числу участников: диапазоны идут подряд без разрывов, начиная с 2. */
    formatSelection: z
      .array(
        z.object({
          minParticipants: z.number().int().min(2).max(512),
          maxParticipants: z.number().int().min(2).max(512).nullable(),
          format: z.enum(COMPETITION_FORMAT_CODES),
        }),
      )
      .min(1)
      .refine(
        (rows) =>
          rows.every((r, i) => {
            if (r.maxParticipants !== null && r.maxParticipants < r.minParticipants) return false;
            if (i === 0) return r.minParticipants === 2;
            const prev = rows[i - 1];
            return prev?.maxParticipants !== null && prev?.maxParticipants !== undefined
              ? r.minParticipants === prev.maxParticipants + 1
              : false;
          }) && rows[rows.length - 1]?.maxParticipants === null,
        { error: 'format_ranges_invalid' },
      ),
  })
  .strict();
export type RuleSetParametersV1 = z.infer<typeof RuleSetParametersV1>;

/** Текущая версия схемы параметров: хранится в RuleSetVersion.schemaVersion. */
export const RULESET_SCHEMA_VERSION = 1;

export const RULESET_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type RuleSetVersionStatus = (typeof RULESET_VERSION_STATUSES)[number];

export const RuleSetsQuery = z.object({
  disciplineCode: z.string().max(40).optional(),
  ownerOrganizationId: Uuid.optional(),
});
export type RuleSetsQuery = z.infer<typeof RuleSetsQuery>;

export const RuleSetCreate = z.object({
  code: Code,
  disciplineCode: z.string().min(2).max(40),
  name: z.string().trim().min(2).max(200),
  /** Нет — шаблон платформы (право `ruleset.manage` на платформе). */
  ownerOrganizationId: Uuid.optional(),
});
export type RuleSetCreate = z.infer<typeof RuleSetCreate>;

/** Параметры проверяются схемой RuleSetParametersV1 в сервисе: ошибка — RULESET_PARAMETERS_INVALID. */
export const RuleSetVersionCreate = z
  .object({
    parameters: z.record(z.string(), z.unknown()).optional(),
    basedOnVersion: z.number().int().min(1).optional(),
  })
  .refine((v) => v.parameters !== undefined || v.basedOnVersion !== undefined, {
    error: 'parameters_or_base_required',
    path: ['parameters'],
  });
export type RuleSetVersionCreate = z.infer<typeof RuleSetVersionCreate>;

export const RuleSetVersionPatch = z.object({ parameters: z.record(z.string(), z.unknown()) });
export type RuleSetVersionPatch = z.infer<typeof RuleSetVersionPatch>;

export interface RuleSetVersionDto {
  id: string;
  ruleSetId: string;
  version: number;
  schemaVersion: number;
  status: RuleSetVersionStatus;
  parameters: Record<string, unknown>;
  checksum: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface RuleSetDto {
  id: string;
  code: string;
  disciplineCode: string;
  name: string;
  owner: OrganizationRef | null;
  status: ProfileStatus;
  latestPublishedVersion: number | null;
  versions: Omit<RuleSetVersionDto, 'parameters'>[];
  allowedActions: string[];
}

/** Канонический JSON: ключи объектов по алфавиту — основа контрольной суммы версии правил. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Пример параметров спортивного самбо (DATABASE.md, 3.4). Значения иллюстративные: утверждает главный судья.
 * Используется как отправная точка новой версии правил в редакторе и в seed.
 */
export const SAMPLE_RULESET_PARAMETERS: RuleSetParametersV1 = {
  matchDuration: [
    { ageFrom: 11, ageTo: 13, seconds: 180 },
    { ageFrom: 14, ageTo: 17, seconds: 240 },
  ],
  repechageMatchSeconds: 180,
  minRestSeconds: 600,
  weighInToleranceGrams: 0,
  actions: [
    { code: 'THROW_TOTAL', kind: 'TOTAL_VICTORY' },
    { code: 'THROW_4', points: 4 },
    { code: 'THROW_2', points: 2 },
    { code: 'THROW_1', points: 1 },
    { code: 'SUBMISSION', kind: 'TOTAL_VICTORY' },
  ],
  hold: {
    thresholds: [
      { seconds: 10, points: 2 },
      { seconds: 20, points: 4 },
    ],
    maxPerMatch: 1,
  },
  penalties: [
    { code: 'REMARK', opponentPoints: 0 },
    { code: 'WARNING_1', opponentPoints: 1 },
    { code: 'WARNING_2', opponentPoints: 2 },
    { code: 'DISQUALIFICATION', kind: 'DISQUALIFICATION' },
  ],
  superiorityPoints: 8,
  tieBreakers: ['LAST_TECHNICAL_ACTION', 'FEWER_PENALTIES', 'REFEREE_DECISION'],
  formatSelection: [
    { minParticipants: 2, maxParticipants: 5, format: 'ROUND_ROBIN' },
    { minParticipants: 6, maxParticipants: null, format: 'ELIMINATION_WITH_REPECHAGE' },
  ],
};
