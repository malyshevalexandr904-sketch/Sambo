// Регистрация в системе по ролям (Phase 9a): заявка руководителя спортивной организации, тренера, спортсмена и судьи,
// её проверка платформой или организацией и присоединение к организации позже. Учётная запись (email + пароль,
// подтверждение email) — прежняя (auth); заявка подаётся вошедшим пользователем и даёт профиль и связи только после
// одобрения. Роль заявки — не роль доступа: права выдаются при одобрении через членства и профили.
import { z } from 'zod';
import { CountryCode, E164, Email, LocalDate, PageQuery, PersonName, Reason, Uuid } from './common.js';
import type { FieldError } from './errors.js';
import { fullYearsOn } from './people.js';

export const ONBOARDING_ROLES = ['ORGANIZATION_HEAD', 'COACH', 'ATHLETE', 'REFEREE'] as const;
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

/** Первичная регистрация или присоединение к организации уже зарегистрированного тренера или спортсмена. */
export const ONBOARDING_KINDS = ['REGISTRATION', 'JOIN_ORGANIZATION'] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];

export const ONBOARDING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PENDING_ORGANIZATION_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'CANCELLED',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** Незавершённые заявки: у пользователя не больше одной такой на роль (уникальный индекс в БД). */
export const OPEN_ONBOARDING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PENDING_ORGANIZATION_APPROVAL',
  'CHANGES_REQUESTED',
] as const satisfies readonly OnboardingStatus[];

export const isOpenOnboardingStatus = (s: OnboardingStatus): boolean =>
  (OPEN_ONBOARDING_STATUSES as readonly string[]).includes(s);

/** Предпочтительные способы связи. Автоматическая отправка — пока только email (и лента, push); см. CHANGELOG. */
export const CONTACT_CHANNELS = ['EMAIL', 'PHONE', 'TELEGRAM'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Правовой статус организации: российское юрлицо даёт выписку ЕГРЮЛ, остальные — иные документы. */
export const ORGANIZATION_LEGAL_FORMS = ['RU_LEGAL_ENTITY', 'FOREIGN', 'OTHER'] as const;
export type OrganizationLegalForm = (typeof ORGANIZATION_LEGAL_FORMS)[number];

/** Типы организаций, которые можно зарегистрировать заявкой руководителя (национальная федерация — только платформой). */
export const ONBOARDING_ORGANIZATION_TYPES = [
  'CLUB',
  'SPORTS_SCHOOL',
  'REGIONAL_FEDERATION',
  'ORGANIZER',
  'OTHER',
] as const;
export type OnboardingOrganizationType = (typeof ONBOARDING_ORGANIZATION_TYPES)[number];

const Inn = z.string().regex(/^(\d{10}|\d{12})$/, { error: 'invalid_inn' });
const Ogrn = z.string().regex(/^(\d{13}|\d{15})$/, { error: 'invalid_ogrn' });
const Telegram = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/, { error: 'invalid_telegram' }));

/** Данные регистрируемой организации (заявка руководителя). Все поля — черновик; обязательность — при отправке. */
export const OnboardingOrganizationInput = z.object({
  name: z.string().trim().min(2, { error: 'too_short' }).max(200, { error: 'too_long' }).nullable(),
  shortName: z.string().trim().min(1).max(60, { error: 'too_long' }).nullable(),
  type: z.enum(ONBOARDING_ORGANIZATION_TYPES).nullable(),
  legalForm: z.enum(ORGANIZATION_LEGAL_FORMS).nullable(),
  countryCode: CountryCode.nullable(),
  regionId: Uuid.nullable(),
  city: z.string().trim().max(100, { error: 'too_long' }).nullable(),
  inn: Inn.nullable(),
  ogrn: Ogrn.nullable(),
  legalName: z.string().trim().min(2).max(300, { error: 'too_long' }).nullable(),
  legalAddress: z.string().trim().min(5).max(500, { error: 'too_long' }).nullable(),
});
export type OnboardingOrganizationInput = z.infer<typeof OnboardingOrganizationInput>;

/** Поля заявки. В черновике любое поле может быть пустым (`null`) — проверка полноты при отправке. */
const OnboardingFields = {
  /** Ответ на вопрос «Вы состоите в спортивной организации?» (тренер, спортсмен). */
  inOrganization: z.boolean().nullable(),
  organizationId: Uuid.nullable(),
  coachId: Uuid.nullable(),
  lastName: PersonName.nullable(),
  firstName: PersonName.nullable(),
  middleName: PersonName.nullable(),
  birthDate: LocalDate.nullable(),
  gender: z.enum(['MALE', 'FEMALE']).nullable(),
  phone: E164.nullable(),
  contactEmail: Email.nullable(),
  telegram: Telegram.nullable(),
  contactChannels: z
    .array(z.enum(CONTACT_CHANNELS))
    .max(CONTACT_CHANNELS.length)
    .refine((a) => new Set(a).size === a.length, { error: 'duplicate_channel' }),
  /** Квалификационная категория тренера (свободный текст: «высшая», «первая», «тренер-преподаватель»…). */
  coachQualification: z.string().trim().max(200, { error: 'too_long' }).nullable(),
  refereeCategoryCode: z.string().trim().min(1).max(40).nullable(),
  organization: OnboardingOrganizationInput.nullable(),
};

export const OnboardingPatch = z.object(OnboardingFields).partial();
export type OnboardingPatch = z.infer<typeof OnboardingPatch>;

export const OnboardingCreate = OnboardingPatch.extend({
  role: z.enum(ONBOARDING_ROLES),
  kind: z.enum(ONBOARDING_KINDS).default('REGISTRATION'),
});
export type OnboardingCreate = z.infer<typeof OnboardingCreate>;

/** Отправка: согласие на обработку персональных данных — обязательно (ФЗ-152). */
export const OnboardingSubmit = z.object({
  consentPersonalData: z.literal(true, { error: 'consent_required' }),
});
export type OnboardingSubmit = z.infer<typeof OnboardingSubmit>;

export const OnboardingDocumentAttach = z.object({
  typeCode: z.string().trim().min(1).max(40),
  fileId: Uuid,
});
export type OnboardingDocumentAttach = z.infer<typeof OnboardingDocumentAttach>;

/** Решение проверяющего: при одобрении комментарий необязателен, при отказе и запросе исправлений — причина. */
export const OnboardingApprove = z.object({ comment: z.string().trim().max(500).optional() });
export type OnboardingApprove = z.infer<typeof OnboardingApprove>;
export const OnboardingReasonRequest = z.object({ reason: Reason });
export type OnboardingReasonRequest = z.infer<typeof OnboardingReasonRequest>;

export const OnboardingReviewQuery = PageQuery.extend({
  role: z.enum(ONBOARDING_ROLES).optional(),
  status: z.enum(ONBOARDING_STATUSES).optional(),
  kind: z.enum(ONBOARDING_KINDS).optional(),
  organizationId: Uuid.optional(),
  /** Только ждущие решения (на проверке платформы или организации). */
  pending: z.stringbool().optional(),
  /** Дата отправки: с — по (включительно). */
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});
export type OnboardingReviewQuery = z.infer<typeof OnboardingReviewQuery>;

export const OnboardingOrganizationsQuery = z.object({
  q: z.string().trim().max(100).optional(),
});
export type OnboardingOrganizationsQuery = z.infer<typeof OnboardingOrganizationsQuery>;

/** Право тренера рассматривать заявки спортсменов, выбравших его, — назначает руководитель организации. */
export const CoachReviewRightsPut = z.object({ enabled: z.boolean() });
export type CoachReviewRightsPut = z.infer<typeof CoachReviewRightsPut>;

// ---------- Документы заявки: правила по ролям (настраиваются платформой) ----------

/** Типы документов заявок (дополняют справочник document_type). */
export const ONBOARDING_DOCUMENT_TYPES = {
  identity: ['PASSPORT', 'BIRTH_CERTIFICATE'],
  egrul: 'EGRUL_EXTRACT',
  refereeBook: 'REFEREE_BOOK',
  coachQualification: 'COACH_QUALIFICATION',
  other: 'OTHER',
} as const;

/**
 * Правило: в заявке роли должен быть (`required`) или может быть хотя бы один документ из `typeCodes`. `when` —
 * условие сценария: ответ «состою в организации», правовой статус организации, указана ли квалификация, категории
 * судьи. Правила применяются к первичной регистрации; присоединение к организации документов не требует.
 */
export const OnboardingDocumentRule = z.object({
  role: z.enum(ONBOARDING_ROLES),
  typeCodes: z.array(z.string().min(1).max(40)).min(1).max(5),
  required: z.boolean(),
  when: z
    .object({
      inOrganization: z.boolean().optional(),
      legalForms: z.array(z.enum(ORGANIZATION_LEGAL_FORMS)).min(1).optional(),
      hasQualification: z.boolean().optional(),
      refereeCategories: z.array(z.string().min(1).max(40)).min(1).optional(),
    })
    .optional(),
});
export type OnboardingDocumentRule = z.infer<typeof OnboardingDocumentRule>;

export const OnboardingDocumentRules = z.array(OnboardingDocumentRule).max(50);

export const DEFAULT_ONBOARDING_DOCUMENT_RULES: OnboardingDocumentRule[] = [
  { role: 'ORGANIZATION_HEAD', typeCodes: ['PASSPORT'], required: true },
  {
    role: 'ORGANIZATION_HEAD',
    typeCodes: ['EGRUL_EXTRACT'],
    required: true,
    when: { legalForms: ['RU_LEGAL_ENTITY'] },
  },
  {
    role: 'ORGANIZATION_HEAD',
    typeCodes: ['OTHER'],
    required: false,
    when: { legalForms: ['FOREIGN', 'OTHER'] },
  },
  { role: 'COACH', typeCodes: ['PASSPORT'], required: true },
  { role: 'COACH', typeCodes: ['COACH_QUALIFICATION'], required: true, when: { hasQualification: true } },
  { role: 'REFEREE', typeCodes: ['PASSPORT'], required: true },
  { role: 'REFEREE', typeCodes: ['REFEREE_BOOK'], required: true },
  { role: 'ATHLETE', typeCodes: ['PASSPORT', 'BIRTH_CERTIFICATE'], required: false },
];

export interface OnboardingScenario {
  role: OnboardingRole;
  kind: OnboardingKind;
  inOrganization: boolean | null;
  legalForm: OrganizationLegalForm | null;
  hasQualification: boolean;
  refereeCategoryCode: string | null;
}

/** Правила документов, действующие для сценария заявки. */
export function documentRulesFor(
  rules: readonly OnboardingDocumentRule[],
  s: OnboardingScenario,
): OnboardingDocumentRule[] {
  if (s.kind !== 'REGISTRATION') return [];
  return rules.filter((r) => {
    if (r.role !== s.role) return false;
    const w = r.when;
    if (!w) return true;
    if (w.inOrganization !== undefined && w.inOrganization !== (s.inOrganization ?? false)) return false;
    if (w.legalForms && (!s.legalForm || !w.legalForms.includes(s.legalForm))) return false;
    if (w.hasQualification !== undefined && w.hasQualification !== s.hasQualification) return false;
    if (
      w.refereeCategories &&
      (!s.refereeCategoryCode || !w.refereeCategories.includes(s.refereeCategoryCode))
    )
      return false;
    return true;
  });
}

/** Типы документов, которые можно приложить к заявке сценария. */
export function allowedDocumentTypes(
  rules: readonly OnboardingDocumentRule[],
  s: OnboardingScenario,
): string[] {
  return [...new Set(documentRulesFor(rules, s).flatMap((r) => r.typeCodes))];
}

// ---------- Полнота заявки (одна проверка для формы и сервера) ----------

/** Данные заявки, нужные для проверки полноты. */
export interface OnboardingCompleteness extends OnboardingScenario {
  organizationId: string | null;
  coachId: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: string | null;
  gender: string | null;
  phone: string | null;
  contactEmail: string | null;
  telegram: string | null;
  contactChannels: readonly ContactChannel[];
  organization: OnboardingOrganizationInput | null;
  /** Типы приложенных документов. */
  documentTypes: readonly string[];
}

/** Возраст на дату подачи: руководитель и тренер — совершеннолетние, судья — от 14 лет, спортсмен — от 5 до 25. */
export const ONBOARDING_AGE_LIMITS: Record<OnboardingRole, { min: number; max: number }> = {
  ORGANIZATION_HEAD: { min: 18, max: 100 },
  COACH: { min: 18, max: 100 },
  REFEREE: { min: 14, max: 100 },
  ATHLETE: { min: 5, max: 25 },
};

/**
 * Что не заполнено или неверно для отправки: ошибки полей с путями формы. Пустой список — заявку можно отправить.
 * Наличие организации, тренера и справочных кодов в БД проверяет сервер отдельно.
 */
export function onboardingProblems(
  r: OnboardingCompleteness,
  rules: readonly OnboardingDocumentRule[],
  today: string = new Date().toISOString().slice(0, 10),
): FieldError[] {
  const out: FieldError[] = [];
  const need = (path: string, value: unknown): void => {
    if (value === null || value === undefined || value === '') out.push({ path, code: 'required' });
  };
  const join = r.kind === 'JOIN_ORGANIZATION';
  if (join && r.role !== 'COACH' && r.role !== 'ATHLETE') out.push({ path: 'kind', code: 'not_allowed' });

  if (!join) {
    need('lastName', r.lastName);
    need('firstName', r.firstName);
    need('birthDate', r.birthDate);
    need('gender', r.gender);
    need('phone', r.phone);
    need('contactEmail', r.contactEmail);
    if (r.birthDate) {
      const age = fullYearsOn(r.birthDate, today);
      const limits = ONBOARDING_AGE_LIMITS[r.role];
      if (r.birthDate > today || age < limits.min || age > limits.max)
        out.push({ path: 'birthDate', code: 'birth_date_out_of_range' });
    }
    if (r.contactChannels.length === 0) out.push({ path: 'contactChannels', code: 'required' });
    if (r.contactChannels.includes('TELEGRAM') && !r.telegram)
      out.push({ path: 'telegram', code: 'required' });
  }

  if (r.role === 'COACH' || r.role === 'ATHLETE') {
    if (join) {
      need('organizationId', r.organizationId);
    } else {
      if (r.inOrganization === null) out.push({ path: 'inOrganization', code: 'required' });
      if (r.inOrganization) need('organizationId', r.organizationId);
    }
    if (r.role === 'ATHLETE' && (join || r.inOrganization)) need('coachId', r.coachId);
  }
  if (r.role === 'REFEREE') need('refereeCategoryCode', r.refereeCategoryCode);
  if (r.role === 'ORGANIZATION_HEAD') {
    const o = r.organization;
    if (!o) {
      out.push({ path: 'organization.name', code: 'required' });
    } else {
      need('organization.name', o.name);
      need('organization.type', o.type);
      need('organization.legalForm', o.legalForm);
      need('organization.countryCode', o.countryCode);
      if (o.legalForm === 'RU_LEGAL_ENTITY') {
        need('organization.inn', o.inn);
        need('organization.legalName', o.legalName);
        need('organization.legalAddress', o.legalAddress);
        if (o.countryCode && o.countryCode !== 'RU')
          out.push({ path: 'organization.countryCode', code: 'must_be_ru' });
      }
    }
  }

  for (const rule of documentRulesFor(rules, r)) {
    if (rule.required && !rule.typeCodes.some((c) => r.documentTypes.includes(c)))
      out.push({ path: `documents.${rule.typeCodes[0]}`, code: 'document_required' });
  }
  return out;
}

/** Куда уходит заявка при отправке: организации (тренер или спортсмен выбрали организацию) или платформе. */
export function onboardingReviewTarget(r: {
  role: OnboardingRole;
  kind: OnboardingKind;
  inOrganization: boolean | null;
}): 'ORGANIZATION' | 'PLATFORM' {
  if (r.role !== 'COACH' && r.role !== 'ATHLETE') return 'PLATFORM';
  return r.kind === 'JOIN_ORGANIZATION' || r.inOrganization ? 'ORGANIZATION' : 'PLATFORM';
}

// ---------- Ответы API ----------

export const ONBOARDING_ACTIONS = [
  'update',
  'submit',
  'cancel',
  'approve',
  'reject',
  'request_changes',
] as const;
export type OnboardingAction = (typeof ONBOARDING_ACTIONS)[number];

export interface OnboardingDocumentDto {
  id: string;
  typeCode: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface OnboardingRequestDto {
  id: string;
  role: OnboardingRole;
  kind: OnboardingKind;
  status: OnboardingStatus;
  inOrganization: boolean | null;
  organization: { id: string; name: string; shortName: string } | null;
  coach: { id: string; publicName: string } | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  birthDate: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  phone: string | null;
  contactEmail: string | null;
  telegram: string | null;
  contactChannels: ContactChannel[];
  coachQualification: string | null;
  refereeCategoryCode: string | null;
  newOrganization: OnboardingOrganizationInput | null;
  documents: OnboardingDocumentDto[];
  /** Правила документов сценария — для формы: какие документы приложить. */
  documentRules: OnboardingDocumentRule[];
  /** Причина отказа или запроса исправлений; комментарий одобрения. */
  decisionReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Организация, созданная при одобрении заявки руководителя. */
  resultOrganizationId: string | null;
  /** Заявитель — только проверяющему. */
  applicant: { userId: string; displayName: string; email: string | null } | null;
  /** Найдено людей с теми же ФИО и датой рождения (проверяющему): возможный дубль. */
  possibleDuplicates: number | null;
  allowedActions: OnboardingAction[];
  version: number;
}

export interface OnboardingHistoryDto {
  id: string;
  fromStatus: OnboardingStatus | null;
  toStatus: OnboardingStatus;
  actor: { id: string; displayName: string } | null;
  reason: string | null;
  createdAt: string;
}

export interface OnboardingOrganizationOption {
  id: string;
  name: string;
  shortName: string;
  city: string | null;
  type: string;
}

export interface OnboardingCoachOption {
  id: string;
  publicName: string;
}

/** Состояние регистрации пользователя для кабинета: заявки и подтверждённые профили. */
export interface OnboardingOverviewDto {
  requests: OnboardingRequestDto[];
  profiles: {
    athleteId: string | null;
    coachId: string | null;
    refereeId: string | null;
    /** Организации, где пользователь — руководитель. */
    managedOrganizationIds: string[];
  };
}
