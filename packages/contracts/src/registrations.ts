// Заявки и участия (API.md, 5.3; DATABASE.md, 3.5; C-02; ARCHITECTURE.md, 16.3).
// Application — заявка клуба на турнир; Entry — спортсмен × категория со снимком данных (ADR-10).
import { z } from 'zod';
import type { EligibilityReason } from './categories.js';
import { Grams, type LocalizedText, PageQuery, Reason, Uuid } from './common.js';
import type { CategoryRef, CategoryWeight, CompetitionStatus } from './competitions.js';
import type { OrganizationRef } from './organizations.js';
import type { Gender } from './people.js';

export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'WAITING_DOCUMENTS',
  'CANCELLED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ENTRY_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Заявки, которые ждут рассмотрения секретариатом. */
export const APPLICATION_QUEUE_STATUSES: readonly ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

const Representation = z.object({
  organizationId: Uuid.nullable().optional(),
  regionId: Uuid.nullable().optional(),
});

export const ApplicationCreate = z.object({
  organizationId: Uuid,
  coachId: Uuid.optional(),
  /** Представительство (D-09): за кого выступают спортсмены; по умолчанию — клуб заявки и его регион. */
  representation: Representation.optional(),
});
export type ApplicationCreate = z.infer<typeof ApplicationCreate>;

export const ApplicationPatch = z
  .object({ coachId: Uuid.nullable(), representation: Representation })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type ApplicationPatch = z.infer<typeof ApplicationPatch>;

export const ApplicationTransitionRequest = z.object({
  to: z.enum(APPLICATION_STATUSES),
  comment: z.string().trim().max(2000).optional(),
});
export type ApplicationTransitionRequest = z.infer<typeof ApplicationTransitionRequest>;

export const ApplicationsQuery = PageQuery.extend({
  status: z.enum(APPLICATION_STATUSES).optional(),
  organizationId: Uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ApplicationsQuery = z.infer<typeof ApplicationsQuery>;

/** Заявки пользователя по всем турнирам (кабинет тренера). */
export const MyApplicationsQuery = PageQuery.extend({
  competitionId: Uuid.optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
});
export type MyApplicationsQuery = z.infer<typeof MyApplicationsQuery>;

export const EntryCreate = z.object({
  athleteId: Uuid,
  categoryId: Uuid,
  declaredWeightGrams: Grams.optional(),
});
export type EntryCreate = z.infer<typeof EntryCreate>;

export const EntryDecisionRequest = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(500).optional(),
});
export type EntryDecisionRequest = z.infer<typeof EntryDecisionRequest>;

export const EntryWithdrawRequest = z.object({ reason: Reason });
export type EntryWithdrawRequest = z.infer<typeof EntryWithdrawRequest>;

export const EntryTransferRequest = z.object({ toCategoryId: Uuid, reason: Reason });
export type EntryTransferRequest = z.infer<typeof EntryTransferRequest>;

export const EntriesQuery = PageQuery.extend({
  categoryId: Uuid.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  organizationId: Uuid.optional(),
  applicationId: Uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export type EntriesQuery = z.infer<typeof EntriesQuery>;

export const EntriesExportQuery = z.object({
  categoryId: Uuid.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
});
export type EntriesExportQuery = z.infer<typeof EntriesExportQuery>;

export const EligibleCategoriesQuery = z.object({
  athleteId: Uuid,
  declaredWeightGrams: z.coerce.number().int().min(10_000).max(250_000).optional(),
});
export type EligibleCategoriesQuery = z.infer<typeof EligibleCategoriesQuery>;

// ---- Ответы ----

export interface CompetitionRef {
  id: string;
  slug: string;
  name: string;
  status: CompetitionStatus;
  startDate: string;
  timezone: string;
}

export interface EntrySnapshot {
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: Gender;
  club: { id: string | null; name: string | null };
  coachName: string | null;
  region: { id: string | null; name: string | null };
  rankCode: string | null;
}

export interface EntryDto {
  id: string;
  competitionId: string;
  applicationId: string;
  organization: OrganizationRef;
  athleteId: string;
  category: CategoryRef;
  declaredCategory: CategoryRef;
  snapshot: EntrySnapshot;
  representation: {
    organization: OrganizationRef | null;
    region: { id: string; name: LocalizedText } | null;
  };
  publicName: string;
  status: EntryStatus;
  declaredWeightGrams: number | null;
  decidedAt: string | null;
  decisionReason: string | null;
  withdrawReason: string | null;
  version: number;
  createdAt: string;
  allowedActions: string[];
}

/** Участие спортсмена с турниром — для карточки спортсмена и выбора турнира при загрузке документа. */
export interface AthleteEntryDto extends EntryDto {
  competition: CompetitionRef;
}

export interface ApplicationSummary {
  id: string;
  competition: CompetitionRef;
  organization: OrganizationRef;
  coach: { id: string; name: string } | null;
  status: ApplicationStatus;
  counts: { entries: number; pending: number; approved: number; rejected: number; withdrawn: number };
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  allowedActions: string[];
}

export interface ApplicationDto extends ApplicationSummary {
  representation: {
    organization: OrganizationRef | null;
    region: { id: string; name: LocalizedText } | null;
  };
  entries: EntryDto[];
  /** Можно ли сейчас добавлять участников: статус заявки, турнира и окно регистрации. */
  canAddEntries: boolean;
}

export interface EligibleCategory extends CategoryRef {
  gender: Gender;
  weight: CategoryWeight;
  /** Заявленный вес в границах категории; null — вес не заявлен. Решает взвешивание. */
  weightMatch: boolean | null;
}

export interface EligibleCategoriesDto {
  athlete: { id: string; publicName: string; birthDate: string; gender: Gender; rankCode: string | null };
  eligible: EligibleCategory[];
  ineligible: { category: EligibleCategory; reasons: EligibilityReason[] }[];
}

/** Имя файла выгрузки участников: `participants-<slug>-<YYYY-MM-DD>.csv`. */
export function entriesExportFileName(slug: string, date: string): string {
  return `participants-${slug}-${date}.csv`;
}
