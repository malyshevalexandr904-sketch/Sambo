// Допуск участия (G-06; ARCHITECTURE.md, 16.3; DATABASE.md, 3.5): какие проверки требует положение и как
// из фактов (документы, согласия, медицинский допуск, взвешивание, прибытие) получается итог проверки.
import {
  type AdmissionCheckKind,
  type AdmissionCheckStatus,
  type AdmissionReason,
  canonicalJson,
  type CheckInStatus,
  type ConsentKind,
  type DocumentStatus,
  type RequirementKind,
  type WeighInStatus,
} from '@sde/contracts';

export interface RequirementFact {
  categoryId: string | null;
  kind: RequirementKind;
  documentTypeCode: string | null;
  consentKind: ConsentKind | null;
  mandatory: boolean;
}

export interface RequiredChecks {
  kinds: Set<AdmissionCheckKind>;
  documentTypes: string[];
  insuranceTypes: string[];
  consentKinds: ConsentKind[];
}

const REQUIREMENT_CHECK: Record<RequirementKind, AdmissionCheckKind> = {
  DOCUMENT: 'DOCUMENTS',
  CONSENT: 'CONSENTS',
  MEDICAL_CLEARANCE: 'MEDICAL',
  INSURANCE: 'INSURANCE',
  WEIGH_IN: 'WEIGHT',
  CHECK_IN: 'CHECK_IN',
};

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Проверки участия: обязательные требования на весь турнир и на категорию участия. */
export function requiredChecks(requirements: readonly RequirementFact[], categoryId: string): RequiredChecks {
  const own = requirements.filter(
    (r) => r.mandatory && (r.categoryId === null || r.categoryId === categoryId),
  );
  const typesOf = (kind: RequirementKind): string[] =>
    uniq(own.filter((r) => r.kind === kind && r.documentTypeCode).map((r) => r.documentTypeCode as string));
  return {
    kinds: new Set(own.map((r) => REQUIREMENT_CHECK[r.kind])),
    documentTypes: typesOf('DOCUMENT'),
    insuranceTypes: typesOf('INSURANCE'),
    consentKinds: uniq(own.filter((r) => r.consentKind).map((r) => r.consentKind as ConsentKind)),
  };
}

export interface CheckOutcome {
  status: Exclude<AdmissionCheckStatus, 'WAIVED'>;
  reasonCode: AdmissionReason | null;
  reasonParams: Record<string, unknown> | null;
}

export const PASSED: CheckOutcome = { status: 'PASSED', reasonCode: null, reasonParams: null };

const pending = (reasonCode: AdmissionReason, reasonParams: Record<string, unknown> | null = null) =>
  ({ status: 'PENDING', reasonCode, reasonParams }) as const satisfies CheckOutcome;

const failed = (reasonCode: AdmissionReason, reasonParams: Record<string, unknown> | null = null) =>
  ({ status: 'FAILED', reasonCode, reasonParams }) as const satisfies CheckOutcome;

export interface DocumentFact {
  typeCode: string;
  status: DocumentStatus;
  expirationDate: string | null;
}

type DocState = 'ok' | 'pending' | 'expired' | 'rejected' | 'missing';

function documentState(docs: readonly DocumentFact[], onDate: string): DocState {
  const valid = (d: DocumentFact): boolean => d.expirationDate === null || d.expirationDate >= onDate;
  if (docs.some((d) => d.status === 'VERIFIED' && valid(d))) return 'ok';
  if (docs.some((d) => (d.status === 'UPLOADED' || d.status === 'UNDER_REVIEW') && valid(d)))
    return 'pending';
  if (docs.some((d) => d.status === 'VERIFIED' || d.status === 'EXPIRED' || !valid(d))) return 'expired';
  if (docs.some((d) => d.status === 'REJECTED')) return 'rejected';
  return 'missing';
}

const FAILURE_ORDER: readonly [DocState, AdmissionReason][] = [
  ['missing', 'document_missing'],
  ['rejected', 'document_rejected'],
  ['expired', 'document_expired'],
];

/**
 * Документы нужных типов (спортсмена или заявки): проверенный и действующий на дату начала турнира — пройдено;
 * загружен и ждёт проверки — ждёт; нет, отклонён или просрочен — не пройдено. Причина — по первому виду отказа,
 * в параметрах — все типы с отказом.
 */
export function evaluateDocuments(
  types: readonly string[],
  docs: readonly DocumentFact[],
  onDate: string,
): CheckOutcome {
  const states = types.map((t) => ({
    type: t,
    state: documentState(
      docs.filter((d) => d.typeCode === t),
      onDate,
    ),
  }));
  const failing = states.filter((s) => s.state !== 'ok' && s.state !== 'pending');
  if (failing.length > 0) {
    const [, reason] = FAILURE_ORDER.find(([state]) => failing.some((s) => s.state === state)) ?? [
      'missing',
      'document_missing' as const,
    ];
    return failed(reason, { types: failing.map((s) => s.type) });
  }
  const waiting = states.filter((s) => s.state === 'pending').map((s) => s.type);
  return waiting.length > 0 ? pending('document_not_verified', { types: waiting }) : PASSED;
}

/** Согласия нужных видов: действующие общие или на этот турнир. */
export function evaluateConsents(
  kinds: readonly ConsentKind[],
  active: ReadonlySet<ConsentKind>,
): CheckOutcome {
  const missing = kinds.filter((k) => !active.has(k));
  return missing.length > 0 ? failed('consent_missing', { kinds: missing }) : PASSED;
}

export interface MedicalFact {
  status: 'VALID' | 'REVOKED';
  validUntil: string;
  createdAt: Date;
}

/**
 * Медицинский допуск (G-05): действующий на дату начала турнира — пройдено; последний допуск отозван врачом —
 * не пройдено; нет допуска — ждёт врача (он выдаёт допуск на мандатной комиссии). Сведения о здоровье в причину
 * не попадают: персонал видит только итог.
 */
export function evaluateMedical(clearances: readonly MedicalFact[], onDate: string): CheckOutcome {
  if (clearances.some((c) => c.status === 'VALID' && c.validUntil >= onDate)) return PASSED;
  const latest = [...clearances].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.status === 'REVOKED' ? failed('medical_revoked') : pending('medical_missing');
}

export interface WeightFact {
  status: WeighInStatus;
  weightGrams: number | null;
  lowerGrams: number | null;
  upperGrams: number | null;
}

export function evaluateWeight(fact: WeightFact | undefined): CheckOutcome {
  switch (fact?.status ?? 'EXPECTED') {
    case 'PASSED':
      return PASSED;
    case 'RECHECK_REQUIRED':
      return pending('weigh_in_recheck_required');
    case 'FAILED':
      return failed('weigh_in_failed', {
        weightGrams: fact?.weightGrams ?? null,
        lowerGrams: fact?.lowerGrams ?? null,
        upperGrams: fact?.upperGrams ?? null,
      });
    default:
      return pending('weigh_in_expected');
  }
}

export function evaluateCheckIn(status: CheckInStatus | undefined): CheckOutcome {
  switch (status ?? 'EXPECTED') {
    case 'ARRIVED':
      return PASSED;
    case 'NOT_ARRIVED':
      return failed('not_arrived');
    case 'WITHDRAWN':
      return failed('check_in_withdrawn');
    default:
      return pending('check_in_expected');
  }
}

export interface StoredCheck {
  status: AdmissionCheckStatus;
  reasonCode: string | null;
  reasonParams: unknown;
  waiverReason: string | null;
}

export interface MergedCheck {
  status: AdmissionCheckStatus;
  reasonCode: AdmissionReason | null;
  reasonParams: Record<string, unknown> | null;
  waiverReason: string | null;
}

/** Исключение остаётся в силе при пересчёте; причина обновляется, чтобы было видно, что именно исключено. */
export function mergeCheck(stored: StoredCheck | undefined, computed: CheckOutcome): MergedCheck {
  if (stored?.status === 'WAIVED')
    return { ...computed, status: 'WAIVED', waiverReason: stored.waiverReason };
  return { ...computed, waiverReason: null };
}

/** Проверку можно исключить, пока она не пройдена и не исключена. */
export const canWaive = (status: AdmissionCheckStatus): boolean =>
  status === 'PENDING' || status === 'FAILED';

/** Изменилась ли проверка: чтобы не писать неизменённые строки (и журнал синхронизации). */
export function checkChanged(stored: StoredCheck, next: MergedCheck): boolean {
  return (
    stored.status !== next.status ||
    stored.reasonCode !== next.reasonCode ||
    stored.waiverReason !== next.waiverReason ||
    canonicalJson(stored.reasonParams ?? null) !== canonicalJson(next.reasonParams ?? null)
  );
}
