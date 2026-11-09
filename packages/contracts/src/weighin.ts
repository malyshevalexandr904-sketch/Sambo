// Взвешивание (API.md, 5.6; DATABASE.md, 3.5; D-06; ARCHITECTURE.md, 14.3, 16.4): весы, окна по дням и
// категориям, попытки append-only и итог взвешивания участия.
import { z } from 'zod';
import type { AdmissionDto, AthleteBrief, CheckInStatus } from './admission.js';
import type { WeightLimitKind } from './categories.js';
import { Grams, Instant, LocalDate, PageQuery, Uuid } from './common.js';
import type { CategoryRef, CategoryWeight } from './competition-categories.js';
import type { WeighInFailureOutcome } from './competitions.js';
import type { OrganizationRef } from './organizations.js';

export const WEIGH_IN_WINDOW_KINDS = ['OFFICIAL', 'CONTROL'] as const;
export type WeighInWindowKind = (typeof WEIGH_IN_WINDOW_KINDS)[number];

export const WEIGH_IN_ATTEMPT_KINDS = ['OFFICIAL', 'CONTROL', 'RECHECK'] as const;
export type WeighInAttemptKind = (typeof WEIGH_IN_ATTEMPT_KINDS)[number];

export const WEIGH_IN_RESULTS = ['PASSED', 'FAILED'] as const;
export type WeighInResult = (typeof WEIGH_IN_RESULTS)[number];

export const WEIGH_IN_STATUSES = ['EXPECTED', 'PASSED', 'FAILED', 'RECHECK_REQUIRED'] as const;
export type WeighInStatus = (typeof WEIGH_IN_STATUSES)[number];

export interface WeightLimits {
  kind: WeightLimitKind;
  lowerGrams: number | null;
  upperGrams: number | null;
}

/**
 * Соответствие веса категории (ARCHITECTURE.md, 14.3): `lower < weight ≤ upper + tolerance`; у категории
 * «свыше» верхней границы нет, у самой лёгкой «до» — нижней.
 */
export function weighInResult(
  weightGrams: number,
  limits: WeightLimits,
  toleranceGrams: number,
): WeighInResult {
  if (limits.lowerGrams !== null && weightGrams <= limits.lowerGrams) return 'FAILED';
  if (
    limits.kind === 'UP_TO' &&
    limits.upperGrams !== null &&
    weightGrams > limits.upperGrams + toleranceGrams
  )
    return 'FAILED';
  return 'PASSED';
}

/** Вид попытки, который допускает окно: официальное окно — официальная и повторная, контрольное — контрольная. */
export function attemptKindsForWindow(kind: WeighInWindowKind): readonly WeighInAttemptKind[] {
  return kind === 'OFFICIAL' ? ['OFFICIAL', 'RECHECK'] : ['CONTROL', 'RECHECK'];
}

/** Вес в килограммах для ввода и показа: 42,35 кг ↔ 42350 г. */
export function gramsToKg(grams: number, locale: 'ru' | 'en'): string {
  const text = (grams / 1000).toFixed(grams % 10 === 0 ? (grams % 100 === 0 ? 1 : 2) : 3);
  return locale === 'ru' ? text.replace('.', ',') : text;
}

/** «42,35» / «42.35» → 42350; не число — null. */
export function kgToGrams(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 1000);
}

// ---- Запросы ----

const Name = z.string().trim().min(1).max(100);

export const ScaleInput = z.object({
  name: Name,
  serialNumber: z.string().trim().max(60).nullable().optional(),
  verifiedUntil: LocalDate,
});
export type ScaleInput = z.infer<typeof ScaleInput>;

export const ScalePatch = ScaleInput.partial().refine((v) => Object.keys(v).length > 0, {
  error: 'empty_patch',
});
export type ScalePatch = z.infer<typeof ScalePatch>;

const WindowFields = z.object({
  name: Name,
  startsAt: Instant,
  endsAt: Instant,
  kind: z.enum(WEIGH_IN_WINDOW_KINDS).default('OFFICIAL'),
  categoryIds: z.array(Uuid).min(1).max(200),
});

const periodValid = (v: { startsAt?: string; endsAt?: string }): boolean =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);

export const WeighInWindowInput = WindowFields.refine(periodValid, {
  error: 'period_invalid',
  path: ['endsAt'],
});
export type WeighInWindowInput = z.infer<typeof WeighInWindowInput>;

export const WeighInWindowPatch = WindowFields.partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' })
  .refine(periodValid, { error: 'period_invalid', path: ['endsAt'] });
export type WeighInWindowPatch = z.infer<typeof WeighInWindowPatch>;

export const WeighInQuery = PageQuery.extend({
  windowId: Uuid.optional(),
  categoryId: Uuid.optional(),
  status: z.enum(WEIGH_IN_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  /** QR участника из личного кабинета спортсмена: только его участия. */
  qrToken: z.string().trim().min(10).max(2000).optional(),
});
export type WeighInQuery = z.infer<typeof WeighInQuery>;

export const WeighInCreate = z.object({
  windowId: Uuid,
  scaleId: Uuid,
  weightGrams: Grams,
  kind: z.enum(WEIGH_IN_ATTEMPT_KINDS),
  note: z.string().trim().max(500).optional(),
});
export type WeighInCreate = z.infer<typeof WeighInCreate>;

// ---- Ответы ----

export interface ScaleDto {
  id: string;
  name: string;
  serialNumber: string | null;
  verifiedUntil: string;
  /** Поверка действует на сегодня в часовом поясе турнира. */
  verified: boolean;
}

export interface WeighInWindowDto {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  kind: WeighInWindowKind;
  categories: CategoryRef[];
  /** Окно открыто сейчас. */
  open: boolean;
  attempts: number;
}

export interface WeighInAttemptDto {
  id: string;
  entryId: string;
  category: CategoryRef;
  /** Окно и весы; у быстрого решения (норма / недовес / перевес) без настройки окна — пусто. */
  windowId: string | null;
  scale: { id: string; name: string } | null;
  /** Вес; у быстрого решения без ввода веса — пусто. */
  weightGrams: number | null;
  measuredAt: string;
  kind: WeighInAttemptKind;
  result: WeighInResult;
  limits: WeightLimits;
  toleranceGrams: number;
  note: string | null;
}

export interface WeighInRecordDto {
  entryId: string;
  status: WeighInStatus;
  lastAttempt: WeighInAttemptDto | null;
  /** Какие виды попыток можно записать сейчас. */
  allowedKinds: WeighInAttemptKind[];
}

export interface WeighInRow {
  entryId: string;
  /** Версия участия — для перевода в другую категорию (If-Match). */
  entryVersion: number;
  athlete: AthleteBrief;
  organization: OrganizationRef;
  category: CategoryRef & { weight: CategoryWeight };
  declaredWeightGrams: number | null;
  checkIn: { status: CheckInStatus };
  record: WeighInRecordDto;
}

export interface WeighInOutcomeDto {
  attempt: WeighInAttemptDto;
  record: WeighInRecordDto;
  admission: AdmissionDto;
  /** Категории, подходящие по весу, если положение переводит участника при неудачном взвешивании (D-06). */
  suggestedCategories?: (CategoryRef & { weight: CategoryWeight })[];
}

/** Настройки взвешивания турнира для экрана: допуск по весу из правил и исход по положению. */
export interface WeighInSettingsDto {
  toleranceGrams: number;
  failureOutcome: WeighInFailureOutcome;
}

// ---- Быстрое взвешивание (правки 09.11.2026, п. 3) ----

/** Решение оператора у весов: норма, недовес или перевес. */
export const WEIGH_IN_VERDICTS = ['NORMAL', 'UNDER', 'OVER'] as const;
export type WeighInVerdict = (typeof WEIGH_IN_VERDICTS)[number];

/**
 * Недовес или перевес: спортсмен не участвует (снимается) или переводится в соседнюю весовую категорию — ниже при
 * недовесе, выше при перевесе. Вес вводить не обязательно. Прибытие отмечается тем же действием.
 */
export const WeighInDecision = z
  .object({
    verdict: z.enum(WEIGH_IN_VERDICTS),
    action: z.enum(['WITHDRAW', 'TRANSFER']).optional(),
    /** Категория перевода; без неё — соседняя по весу. */
    toCategoryId: Uuid.optional(),
    weightGrams: Grams.optional(),
  })
  .refine((v) => v.verdict === 'NORMAL' || !!v.action, { error: 'action_required', path: ['action'] });
export type WeighInDecision = z.infer<typeof WeighInDecision>;

export const WeighInCardsQuery = z.object({ qrToken: z.string().trim().min(10).max(2000) });
export type WeighInCardsQuery = z.infer<typeof WeighInCardsQuery>;

/** Карточка спортсмена у весов по QR: ФИО, дата рождения, документы, заявленная категория и итог. */
export interface WeighInCardDto {
  entryId: string;
  entryVersion: number;
  athleteId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  organization: OrganizationRef;
  category: CategoryRef & { weight: CategoryWeight };
  /** Соседние весовые категории той же возрастной группы: куда перевести при недовесе и перевесе. */
  lighter: (CategoryRef & { weight: CategoryWeight }) | null;
  heavier: (CategoryRef & { weight: CategoryWeight }) | null;
  documentsOk: boolean;
  weighIn: WeighInStatus;
  checkIn: CheckInStatus;
}
