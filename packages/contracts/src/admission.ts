// Допуск участия и прибытие (API.md, 5.4–5.5; DATABASE.md, 3.5; G-06; ARCHITECTURE.md, 16.3–16.4).
// Допуск — агрегат проверок, требуемых положением для категории участия; прибытие — одна отметка на спортсмена.
import { z } from 'zod';
import { type LocalizedText, PageQuery, Reason, Uuid } from './common.js';
import type { CategoryRef } from './competition-categories.js';
import type { OrganizationRef } from './organizations.js';

export const ADMISSION_STATUSES = ['PENDING', 'ADMITTED', 'NOT_ADMITTED'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/**
 * Виды проверок. AGE и QUALIFICATION проверяются при подаче и переводе участия (eligible-categories) и
 * зарезервированы для отдельной проверки на мандатной комиссии.
 */
export const ADMISSION_CHECK_KINDS = [
  'DOCUMENTS',
  'CONSENTS',
  'MEDICAL',
  'INSURANCE',
  'AGE',
  'QUALIFICATION',
  'WEIGHT',
  'CHECK_IN',
] as const;
export type AdmissionCheckKind = (typeof ADMISSION_CHECK_KINDS)[number];

export const ADMISSION_CHECK_STATUSES = ['PENDING', 'PASSED', 'FAILED', 'WAIVED'] as const;
export type AdmissionCheckStatus = (typeof ADMISSION_CHECK_STATUSES)[number];

/** Причины проверок: UI переводит по ключу `admission.reasons.<code>`, параметры — в `reasonParams`. */
export const ADMISSION_REASONS = [
  'document_missing',
  'document_not_verified',
  'document_rejected',
  'document_expired',
  'consent_missing',
  'medical_missing',
  'medical_revoked',
  'weigh_in_expected',
  'weigh_in_recheck_required',
  'weigh_in_failed',
  'check_in_expected',
  'not_arrived',
  'check_in_withdrawn',
] as const;
export type AdmissionReason = (typeof ADMISSION_REASONS)[number];

export const CHECK_IN_STATUSES = ['EXPECTED', 'ARRIVED', 'NOT_ARRIVED', 'WITHDRAWN'] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

export const CHECK_IN_METHODS = ['QR', 'SEARCH', 'MANUAL'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

/** Статус допуска по проверкам (ARCHITECTURE.md, 16.3): любая FAILED — не допущен; любая PENDING — ждёт. */
export function admissionStatusOf(checks: readonly { status: AdmissionCheckStatus }[]): AdmissionStatus {
  if (checks.some((c) => c.status === 'FAILED')) return 'NOT_ADMITTED';
  if (checks.some((c) => c.status === 'PENDING')) return 'PENDING';
  return 'ADMITTED';
}

// ---- Запросы ----

export const AdmissionQuery = PageQuery.extend({
  status: z.enum(ADMISSION_STATUSES).optional(),
  categoryId: Uuid.optional(),
  checkKind: z.enum(ADMISSION_CHECK_KINDS).optional(),
  /** Только участия с непройденными проверками (FAILED или PENDING). */
  problemsOnly: z.stringbool().optional(),
  q: z.string().trim().max(100).optional(),
});
export type AdmissionQuery = z.infer<typeof AdmissionQuery>;

export const AdmissionWaiveRequest = z.object({ reason: Reason });
export type AdmissionWaiveRequest = z.infer<typeof AdmissionWaiveRequest>;

export const CheckInQuery = PageQuery.extend({
  status: z.enum(CHECK_IN_STATUSES).optional(),
  organizationId: Uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export type CheckInQuery = z.infer<typeof CheckInQuery>;

export const CheckInUpdate = z.object({
  status: z.enum(['ARRIVED', 'NOT_ARRIVED', 'WITHDRAWN']),
  method: z.enum(CHECK_IN_METHODS),
  note: z.string().trim().max(500).optional(),
});
export type CheckInUpdate = z.infer<typeof CheckInUpdate>;

export const CheckInScanRequest = z.object({ qrToken: z.string().trim().min(20).max(300) });
export type CheckInScanRequest = z.infer<typeof CheckInScanRequest>;

// ---- Ответы ----

export interface AdmissionCheckDto {
  kind: AdmissionCheckKind;
  status: AdmissionCheckStatus;
  reasonCode: AdmissionReason | null;
  /** Коды и числа для текста причины: типы документов, виды согласий, вес и границы категории. */
  reasonParams: Record<string, unknown> | null;
  waiverReason: string | null;
  updatedAt: string | null;
}

export interface AdmissionDto {
  entryId: string;
  status: AdmissionStatus;
  decidedAt: string | null;
  checks: AdmissionCheckDto[];
  /** `waive:<KIND>` — исключение проверки из допуска (право `admission.override`). */
  allowedActions: string[];
}

/** Краткий допуск для списков: статус и непройденные проверки. */
export interface AdmissionSummary {
  status: AdmissionStatus;
  failed: AdmissionCheckKind[];
  pending: AdmissionCheckKind[];
}

export interface AthleteBrief {
  id: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  publicName: string;
}

export interface AdmissionRow {
  entryId: string;
  athlete: AthleteBrief;
  organization: OrganizationRef;
  category: CategoryRef;
  admission: AdmissionDto;
  checkIn: { status: CheckInStatus };
  weighIn: { status: WeighInStatusCode; lastWeightGrams: number | null };
}

/** Статус взвешивания (объявлен здесь, чтобы строка допуска не зависела от модуля взвешивания). */
export type WeighInStatusCode = 'EXPECTED' | 'PASSED' | 'FAILED' | 'RECHECK_REQUIRED';

export interface CheckInDto {
  athleteId: string;
  status: CheckInStatus;
  method: CheckInMethod | null;
  arrivedAt: string | null;
  note: string | null;
  version: number;
  updatedAt: string;
  allowedActions: string[];
}

export interface CheckInEntry {
  id: string;
  category: CategoryRef;
  organization: OrganizationRef;
  admission: AdmissionSummary;
}

export interface CheckInRow {
  athlete: AthleteBrief;
  entries: CheckInEntry[];
  checkIn: CheckInDto;
}

/** Счётчики раздела 15 ТЗ — по спортсменам: заявлено, подтверждено, прибыло, не прибыло, проблемные документы. */
export interface CheckInSummaryDto {
  declared: number;
  approved: number;
  expected: number;
  arrived: number;
  notArrived: number;
  withdrawn: number;
  problemDocuments: number;
}

export interface EntryQrDto {
  qrToken: string;
  svg: string;
  expiresAt: string;
  competition: { id: string; name: string };
  athlete: { publicName: string };
  categories: { code: string; name: LocalizedText }[];
}
