// Турниры, положение, персонал, места проведения и правила допуска (API.md, 5.1; ARCHITECTURE.md, 16.1).
// Категории турнира — competition-categories.ts, публичная витрина — public.ts.
import { z } from 'zod';
import { CONSENT_KINDS, type ConsentKind } from './athletes.js';
import { CATEGORY_RULE_KINDS, CATEGORY_RULE_PARAMS, type CategoryRuleKind } from './categories.js';
import { E164, Email, Instant, LocalDate, PageQuery, Reason, Slug, Timezone, Uuid } from './common.js';
import type { OrganizationRef } from './organizations.js';
import { COMPETITION_ROLE_CODES, type RoleCode } from './roles.js';
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
