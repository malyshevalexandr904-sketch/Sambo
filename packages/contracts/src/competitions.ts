// Турниры, положение, персонал, места проведения, категории турнира и правила допуска
// (API.md, 5.1–5.2, 5.9; DATABASE.md, 3.4; ARCHITECTURE.md, 16.1–16.2).
import { z } from 'zod';
import { CONSENT_KINDS, type ConsentKind } from './athletes.js';
import {
  AGE_POLICIES,
  type AgeCalculationPolicy,
  CATEGORY_RULE_KINDS,
  CATEGORY_RULE_PARAMS,
  type CategoryRuleKind,
  WEIGHT_LIMIT_KINDS,
  type WeightLimitKind,
} from './categories.js';
import {
  E164,
  Email,
  Grams,
  Instant,
  LocalDate,
  type LocalizedText,
  PageQuery,
  Reason,
  Slug,
  Timezone,
  Uuid,
} from './common.js';
import type { OrganizationRef } from './organizations.js';
import { GENDERS, type Gender } from './people.js';
import { COMPETITION_ROLE_CODES, type RoleCode } from './roles.js';
import { COMPETITION_FORMAT_CODES, type CompetitionFormatCode } from './rulesets.js';
import { localDateIn } from './time.js';

// ---- Справочные перечисления ----

export const COMPETITION_STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECK_IN',
  'DRAWING',
  'SCHEDULED',
  'IN_PROGRESS',
  'FINISHED',
  'ARCHIVED',
  'CANCELLED',
] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const COMPETITION_LEVELS = [
  'CLUB',
  'CITY',
  'REGIONAL',
  'INTERREGIONAL',
  'NATIONAL',
  'INTERNATIONAL',
] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];

export const CATEGORY_STATUSES = [
  'REGISTRATION',
  'CLOSED',
  'WEIGH_IN',
  'READY_FOR_DRAW',
  'DRAWN',
  'IN_PROGRESS',
  'COMPLETED',
  'RESULTS_PUBLISHED',
  'MERGED',
  'CANCELLED',
] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export const REQUIREMENT_KINDS = [
  'DOCUMENT',
  'CONSENT',
  'MEDICAL_CLEARANCE',
  'INSURANCE',
  'WEIGH_IN',
  'CHECK_IN',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Держатель права записи турнира (ADR-21): до Phase 9.5 — всегда облако. */
export const LEASE_HOLDERS = ['CLOUD', 'NODE'] as const;
export type LeaseHolder = (typeof LEASE_HOLDERS)[number];

/** Статусы, в которых турнир виден публично (всё, кроме черновика). */
export const PUBLIC_COMPETITION_STATUSES = COMPETITION_STATUSES.filter((s) => s !== 'DRAFT');

// ---- Турнир ----

const MarkdownText = z.string().max(20_000, { error: 'too_long' });

export const CompetitionContactInfo = z.object({
  name: z.string().trim().max(200).optional(),
  email: Email.optional(),
  phone: E164.optional(),
});
export type CompetitionContactInfo = z.infer<typeof CompetitionContactInfo>;

const CompetitionFields = {
  name: z.string().trim().min(3, { error: 'too_short' }).max(200, { error: 'too_long' }),
  shortName: z.string().trim().max(60).optional(),
  slug: Slug.optional(),
  venueId: Uuid.nullable().optional(),
  timezone: Timezone,
  startDate: LocalDate,
  endDate: LocalDate,
  registrationStartsAt: Instant,
  registrationEndsAt: Instant,
  level: z.enum(COMPETITION_LEVELS),
  disciplineCode: z.string().min(2).max(40),
  /** Обязательна к публикации; только опубликованная версия правил. */
  ruleSetVersionId: Uuid.nullable().optional(),
  descriptionMd: MarkdownText.optional(),
  logoFileId: Uuid.nullable().optional(),
  contactInfo: CompetitionContactInfo.optional(),
};

interface Schedule {
  timezone?: string;
  startDate?: string;
  endDate?: string;
  registrationStartsAt?: string;
  registrationEndsAt?: string;
}

/**
 * Согласованность сроков (раздел 53): начало ≤ окончание турнира; регистрация открывается раньше, чем
 * закрывается, и закрывается не позже даты начала турнира в его часовом поясе.
 */
export function scheduleIssues(v: Schedule): { path: string; code: string }[] {
  const issues: { path: string; code: string }[] = [];
  if (v.startDate && v.endDate && v.startDate > v.endDate)
    issues.push({ path: 'endDate', code: 'end_before_start' });
  if (
    v.registrationStartsAt &&
    v.registrationEndsAt &&
    Date.parse(v.registrationStartsAt) >= Date.parse(v.registrationEndsAt)
  )
    issues.push({ path: 'registrationEndsAt', code: 'registration_window_invalid' });
  if (v.registrationEndsAt && v.startDate && v.timezone) {
    try {
      if (localDateIn(v.registrationEndsAt, v.timezone) > v.startDate)
        issues.push({ path: 'registrationEndsAt', code: 'registration_after_start' });
    } catch {
      // Неверный часовой пояс ловит схема Timezone.
    }
  }
  return issues;
}

export const CompetitionCreate = z
  .object({ ...CompetitionFields, organizerOrganizationId: Uuid })
  .superRefine((v, ctx) => {
    for (const i of scheduleIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.code });
  });
export type CompetitionCreate = z.infer<typeof CompetitionCreate>;

/**
 * Изменение турнира. Сроки опубликованного турнира меняются только с причиной (`reason`) —
 * участники получают уведомление; дисциплину и версию правил после публикации изменить нельзя.
 */
export const CompetitionPatch = z
  .object({ ...CompetitionFields, reason: Reason })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'reason'), { error: 'empty_patch' });
export type CompetitionPatch = z.infer<typeof CompetitionPatch>;

export const CompetitionsQuery = PageQuery.extend({
  status: z.enum(COMPETITION_STATUSES).optional(),
  organizerId: Uuid.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  q: z.string().trim().max(100).optional(),
  /** Только турниры, где у пользователя служебная роль (организатор, персонал), включая черновики. */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Только турниры с открытой регистрацией. */
  registrationOpen: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type CompetitionsQuery = z.infer<typeof CompetitionsQuery>;

export const CompetitionTransitionRequest = z.object({
  to: z.enum(COMPETITION_STATUSES),
  reason: Reason.optional(),
  /** Продление регистрации (REGISTRATION_CLOSED → REGISTRATION_OPEN): новый срок окончания. */
  registrationEndsAt: Instant.optional(),
  /** Переход с предупреждением (например, остались нерассмотренные заявки) — подтверждён пользователем. */
  confirm: z.boolean().optional(),
});
export type CompetitionTransitionRequest = z.infer<typeof CompetitionTransitionRequest>;

export interface VenueRef {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
}

export interface WriteAuthority {
  holder: LeaseHolder;
  epoch: number;
}

export interface CompetitionSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  organizer: OrganizationRef;
  venue: VenueRef | null;
  timezone: string;
  startDate: string;
  endDate: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
  status: CompetitionStatus;
  level: CompetitionLevel;
  disciplineCode: string;
  /** Регистрация открыта сейчас: статус и окно регистрации. */
  registrationOpenNow: boolean;
  logoUrl: string | null;
}

export interface RuleSetVersionRef {
  id: string;
  ruleSetId: string;
  ruleSetCode: string;
  ruleSetName: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  checksum: string | null;
}

export interface Competition extends CompetitionSummary {
  descriptionMd: string | null;
  ruleSetVersion: RuleSetVersionRef | null;
  logoFileId: string | null;
  regulation: { fileId: string; url: string | null; fileName: string } | null;
  requirementsMd: string | null;
  contactInfo: CompetitionContactInfo | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  counters: { categories: number; applications: number; entriesApproved: number; entriesPending: number };
  writeAuthority: WriteAuthority;
  /** Роли пользователя в турнире и отношение к нему (для кабинетов). */
  viewer: { roles: RoleCode[]; staff: boolean };
  version: number;
  createdAt: string;
  updatedAt: string;
  allowedActions: string[];
}

// ---- Положение: файл, текст требований, требования и правила допуска ----

export const RegulationUpdate = z.object({
  regulationFileId: Uuid.nullable().optional(),
  requirementsMd: MarkdownText,
});
export type RegulationUpdate = z.infer<typeof RegulationUpdate>;

export const RequirementInput = z
  .object({
    categoryId: Uuid.nullable().optional(),
    kind: z.enum(REQUIREMENT_KINDS),
    documentTypeCode: z.string().min(2).max(60).nullable().optional(),
    consentKind: z.enum(CONSENT_KINDS).nullable().optional(),
    mandatory: z.boolean().default(true),
    noteMd: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const needsDoc = v.kind === 'DOCUMENT' || v.kind === 'INSURANCE';
    if (needsDoc !== !!v.documentTypeCode)
      ctx.addIssue({
        code: 'custom',
        path: ['documentTypeCode'],
        message: needsDoc ? 'required' : 'not_allowed',
      });
    if ((v.kind === 'CONSENT') !== !!v.consentKind)
      ctx.addIssue({
        code: 'custom',
        path: ['consentKind'],
        message: v.kind === 'CONSENT' ? 'required' : 'not_allowed',
      });
  });
export type RequirementInput = z.infer<typeof RequirementInput>;

export const RequirementsPut = z.object({ requirements: z.array(RequirementInput).max(50) });
export type RequirementsPut = z.infer<typeof RequirementsPut>;

export interface RequirementDto {
  id: string;
  categoryId: string | null;
  kind: RequirementKind;
  documentTypeCode: string | null;
  consentKind: ConsentKind | null;
  mandatory: boolean;
  noteMd: string | null;
}

export const CategoryRuleInput = z
  .object({
    categoryId: Uuid.nullable().optional(),
    kind: z.enum(CATEGORY_RULE_KINDS),
    params: z.record(z.string(), z.unknown()),
  })
  .superRefine((v, ctx) => {
    const result = CATEGORY_RULE_PARAMS[v.kind].safeParse(v.params);
    if (!result.success)
      for (const i of result.error.issues)
        ctx.addIssue({ code: 'custom', path: ['params', ...i.path.map(String)], message: i.message });
  });
export type CategoryRuleInput = z.infer<typeof CategoryRuleInput>;

export const CategoryRulesPut = z.object({ rules: z.array(CategoryRuleInput).max(100) });
export type CategoryRulesPut = z.infer<typeof CategoryRulesPut>;

export interface CategoryRuleDto {
  id: string;
  categoryId: string | null;
  kind: CategoryRuleKind;
  params: Record<string, unknown>;
}

// ---- Персонал турнира ----

const CompetitionRole = z.enum(COMPETITION_ROLE_CODES as [RoleCode, ...RoleCode[]]);

export const CompetitionMemberInvite = z
  .object({ email: Email.optional(), userId: Uuid.optional(), roleCode: CompetitionRole })
  .refine((v) => (v.email === undefined) !== (v.userId === undefined), {
    error: 'email_or_user_required',
    path: ['email'],
  });
export type CompetitionMemberInvite = z.infer<typeof CompetitionMemberInvite>;

export const CompetitionMemberPatch = z.object({ status: z.enum(['SUSPENDED', 'ACTIVE', 'ENDED']) });
export type CompetitionMemberPatch = z.infer<typeof CompetitionMemberPatch>;

export const CompetitionMembersQuery = PageQuery.extend({
  role: CompetitionRole.optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED']).optional(),
});
export type CompetitionMembersQuery = z.infer<typeof CompetitionMembersQuery>;

export interface CompetitionMember {
  id: string;
  competitionId: string;
  user: { id: string; displayName: string; email: string | null } | null;
  invitedEmail: string | null;
  roleCode: RoleCode;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'ENDED';
  version: number;
  createdAt: string;
}

export const AcceptCompetitionInviteRequest = z.object({ token: z.string().min(20).max(200) });
export type AcceptCompetitionInviteRequest = z.infer<typeof AcceptCompetitionInviteRequest>;

// ---- Места проведения ----

export const VenueInput = z.object({
  ownerOrganizationId: Uuid,
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  regionId: Uuid.optional(),
  timezone: Timezone,
});
export type VenueInput = z.infer<typeof VenueInput>;

export const VenuePatch = VenueInput.omit({ ownerOrganizationId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type VenuePatch = z.infer<typeof VenuePatch>;

export const VenuesQuery = z.object({ ownerOrganizationId: Uuid.optional() });
export type VenuesQuery = z.infer<typeof VenuesQuery>;

export interface VenueDto extends VenueRef {
  ownerOrganizationId: string;
  regionId: string | null;
  timezone: string;
  allowedActions: string[];
}

// ---- Категории турнира ----

const CategoryCode = z.string().regex(/^[A-Z0-9][A-Z0-9_+-]{1,39}$/, { error: 'invalid_code' });
const Age = z.number().int().min(5).max(99);
const Year = z.number().int().min(1950).max(2100);
const LocalizedName = z.object({
  ru: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
});

export const CategoryAgeInput = z
  .object({
    policy: z.enum(AGE_POLICIES),
    ageFrom: Age.nullable().optional(),
    ageTo: Age.nullable().optional(),
    birthYearFrom: Year.nullable().optional(),
    birthYearTo: Year.nullable().optional(),
    referenceDate: LocalDate.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.policy === 'BIRTH_YEAR_RANGE') {
      if (v.birthYearFrom == null && v.birthYearTo == null)
        ctx.addIssue({ code: 'custom', path: ['birthYearFrom'], message: 'required' });
      if (v.birthYearFrom != null && v.birthYearTo != null && v.birthYearFrom > v.birthYearTo)
        ctx.addIssue({ code: 'custom', path: ['birthYearTo'], message: 'range_invalid' });
    } else {
      if (v.ageFrom == null && v.ageTo == null)
        ctx.addIssue({ code: 'custom', path: ['ageFrom'], message: 'required' });
      if (v.ageFrom != null && v.ageTo != null && v.ageFrom > v.ageTo)
        ctx.addIssue({ code: 'custom', path: ['ageTo'], message: 'age_range_invalid' });
    }
  });
export type CategoryAgeInput = z.infer<typeof CategoryAgeInput>;

export const CategoryWeightInput = z
  .object({
    kind: z.enum(WEIGHT_LIMIT_KINDS),
    lowerGrams: Grams.nullable().optional(),
    upperGrams: Grams.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ABOVE') {
      if (v.lowerGrams == null) ctx.addIssue({ code: 'custom', path: ['lowerGrams'], message: 'required' });
      if (v.upperGrams != null)
        ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'not_allowed' });
    } else {
      if (v.upperGrams == null) ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'required' });
      if (v.lowerGrams != null && v.upperGrams != null && v.lowerGrams >= v.upperGrams)
        ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'weight_range_invalid' });
    }
  });
export type CategoryWeightInput = z.infer<typeof CategoryWeightInput>;

export const CategoryInput = z.object({
  code: CategoryCode,
  name: LocalizedName,
  gender: z.enum(GENDERS),
  ageGroupId: Uuid.nullable().optional(),
  age: CategoryAgeInput,
  weight: CategoryWeightInput,
  formatOverride: z.enum(COMPETITION_FORMAT_CODES).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const CategoryPatch = z
  .object({
    code: CategoryCode,
    name: LocalizedName,
    age: CategoryAgeInput,
    weight: CategoryWeightInput,
    formatOverride: z.enum(COMPETITION_FORMAT_CODES).nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type CategoryPatch = z.infer<typeof CategoryPatch>;

export const CategoriesQuery = z.object({
  gender: z.enum(GENDERS).optional(),
  ageGroupId: Uuid.optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type CategoriesQuery = z.infer<typeof CategoriesQuery>;

export const CategoryGenerateRequest = z.object({
  templateId: Uuid,
  /** Заменить все категории турнира (только пока в нём нет участий). */
  replaceExisting: z.boolean().default(false),
});
export type CategoryGenerateRequest = z.infer<typeof CategoryGenerateRequest>;

export const CategoryTransitionRequest = z.object({
  to: z.enum(CATEGORY_STATUSES),
  reason: Reason.optional(),
});
export type CategoryTransitionRequest = z.infer<typeof CategoryTransitionRequest>;

export const CategoryMergeRequest = z
  .object({
    sourceCategoryIds: z.array(Uuid).min(1).max(10),
    targetCategoryId: Uuid,
    reason: Reason,
  })
  .refine((v) => !v.sourceCategoryIds.includes(v.targetCategoryId), {
    error: 'target_in_sources',
    path: ['targetCategoryId'],
  })
  .refine((v) => new Set(v.sourceCategoryIds).size === v.sourceCategoryIds.length, {
    error: 'duplicate_ids',
    path: ['sourceCategoryIds'],
  });
export type CategoryMergeRequest = z.infer<typeof CategoryMergeRequest>;

export interface CategoryAge {
  policy: AgeCalculationPolicy;
  ageFrom: number | null;
  ageTo: number | null;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  referenceDate: string | null;
}

export interface CategoryWeight {
  kind: WeightLimitKind;
  lowerGrams: number | null;
  upperGrams: number | null;
}

export interface CategoryRef {
  id: string;
  code: string;
  name: LocalizedText;
}

export interface CompetitionCategoryDto extends CategoryRef {
  competitionId: string;
  gender: Gender;
  ageGroupId: string | null;
  age: CategoryAge;
  weight: CategoryWeight;
  formatOverride: CompetitionFormatCode | null;
  status: CategoryStatus;
  mergedIntoId: string | null;
  sortOrder: number;
  /** Действующие участия (не отклонённые и не снятые) и одобренные. */
  entries: { active: number; approved: number };
  version: number;
  allowedActions: string[];
}

/** Подпись веса категории: «до 38 кг», «свыше 72 кг» (UP_TO без верхней границы не бывает). */
export function categoryWeightLabel(w: CategoryWeight, locale: 'ru' | 'en'): string {
  const kg = (g: number): string => {
    const v = g / 1000;
    const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return locale === 'ru' ? text.replace('.', ',') : text;
  };
  if (w.kind === 'ABOVE')
    return locale === 'ru' ? `свыше ${kg(w.lowerGrams ?? 0)} кг` : `over ${kg(w.lowerGrams ?? 0)} kg`;
  return locale === 'ru' ? `до ${kg(w.upperGrams ?? 0)} кг` : `up to ${kg(w.upperGrams ?? 0)} kg`;
}

// ---- Публичная витрина турнира (API.md, 5.9; ADR-15: белый список полей) ----

export const PublicCompetitionsQuery = PageQuery.extend({
  status: z.enum(PUBLIC_COMPETITION_STATUSES as [CompetitionStatus, ...CompetitionStatus[]]).optional(),
  regionId: Uuid.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});
export type PublicCompetitionsQuery = z.infer<typeof PublicCompetitionsQuery>;

export interface PublicCompetitionSummary {
  slug: string;
  name: string;
  shortName: string | null;
  status: CompetitionStatus;
  level: CompetitionLevel;
  startDate: string;
  endDate: string;
  timezone: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
  registrationOpenNow: boolean;
  organizerName: string;
  city: string | null;
  regionName: LocalizedText | null;
  logoUrl: string | null;
}

export interface PublicCompetitionCategory {
  code: string;
  name: LocalizedText;
  gender: Gender;
  age: CategoryAge;
  weight: CategoryWeight;
  status: CategoryStatus;
  /** Одобренные участия. */
  participants: number;
}

export interface PublicCompetition extends PublicCompetitionSummary {
  descriptionMd: string | null;
  discipline: LocalizedText;
  venue: { name: string; address: string | null; city: string | null } | null;
  regulationUrl: string | null;
  requirementsMd: string | null;
  requirements: {
    kind: RequirementKind;
    categoryCode: string | null;
    documentType: LocalizedText | null;
    consentKind: string | null;
    mandatory: boolean;
    noteMd: string | null;
  }[];
  categories: PublicCompetitionCategory[];
  contacts: CompetitionContactInfo | null;
  cancelReason: string | null;
}
