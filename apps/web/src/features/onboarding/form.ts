// Состояние формы заявки (Phase 9a): строки полей ввода ↔ заявка API. Пустое поле — null на сервере; поля, не
// относящиеся к роли и ответам, сервер очищает сам.
import {
  type ContactChannel,
  type OnboardingCompleteness,
  type OnboardingOrganizationType,
  type OnboardingPatch,
  type OnboardingRequestDto,
  type OrganizationLegalForm,
} from '@sde/contracts';

export interface OrgForm {
  name: string;
  shortName: string;
  type: string;
  legalForm: string;
  countryCode: string;
  regionId: string;
  city: string;
  inn: string;
  ogrn: string;
  legalName: string;
  legalAddress: string;
}

export interface OnboardingForm {
  inOrganization: boolean | null;
  organizationId: string;
  coachId: string;
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  gender: string;
  phone: string;
  contactEmail: string;
  telegram: string;
  contactChannels: ContactChannel[];
  coachQualification: string;
  refereeCategoryCode: string;
  org: OrgForm;
}

const s = (v: string | null | undefined): string => v ?? '';
const n = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function formOf(r: OnboardingRequestDto): OnboardingForm {
  const o = r.newOrganization;
  return {
    inOrganization: r.inOrganization,
    organizationId: r.organization?.id ?? '',
    coachId: r.coach?.id ?? '',
    lastName: s(r.lastName),
    firstName: s(r.firstName),
    middleName: s(r.middleName),
    birthDate: s(r.birthDate),
    gender: s(r.gender),
    phone: s(r.phone),
    contactEmail: s(r.contactEmail),
    telegram: s(r.telegram),
    contactChannels: r.contactChannels,
    coachQualification: s(r.coachQualification),
    refereeCategoryCode: s(r.refereeCategoryCode),
    org: {
      name: s(o?.name),
      shortName: s(o?.shortName),
      type: s(o?.type),
      legalForm: s(o?.legalForm),
      countryCode: s(o?.countryCode) || 'RU',
      regionId: s(o?.regionId),
      city: s(o?.city),
      inn: s(o?.inn),
      ogrn: s(o?.ogrn),
      legalName: s(o?.legalName),
      legalAddress: s(o?.legalAddress),
    },
  };
}

/** Изменение заявки целиком: сервер сохранит только поля сценария. */
export function patchOf(f: OnboardingForm, r: OnboardingRequestDto): OnboardingPatch {
  const base: OnboardingPatch = {
    inOrganization: f.inOrganization,
    organizationId: n(f.organizationId),
    coachId: n(f.coachId),
    contactChannels: f.contactChannels,
    telegram: n(f.telegram),
  };
  if (r.kind === 'JOIN_ORGANIZATION') return base;
  const patch: OnboardingPatch = {
    ...base,
    lastName: n(f.lastName),
    firstName: n(f.firstName),
    middleName: n(f.middleName),
    birthDate: n(f.birthDate),
    gender: f.gender === 'MALE' || f.gender === 'FEMALE' ? f.gender : null,
    phone: n(f.phone),
    contactEmail: n(f.contactEmail),
  };
  if (r.role === 'COACH') patch.coachQualification = n(f.coachQualification);
  if (r.role === 'REFEREE') patch.refereeCategoryCode = n(f.refereeCategoryCode);
  if (r.role === 'ORGANIZATION_HEAD') {
    patch.organization = {
      name: n(f.org.name),
      shortName: n(f.org.shortName),
      type: n(f.org.type) as OnboardingOrganizationType | null,
      legalForm: n(f.org.legalForm) as OrganizationLegalForm | null,
      countryCode: n(f.org.countryCode),
      regionId: n(f.org.regionId),
      city: n(f.org.city),
      inn: n(f.org.inn),
      ogrn: n(f.org.ogrn),
      legalName: n(f.org.legalName),
      legalAddress: n(f.org.legalAddress),
    };
  }
  return patch;
}

/** Данные для общей проверки полноты (contracts: onboardingProblems) — та же логика, что на сервере. */
export function completenessOf(f: OnboardingForm, r: OnboardingRequestDto): OnboardingCompleteness {
  const legalForm = n(f.org.legalForm) as OrganizationLegalForm | null;
  return {
    role: r.role,
    kind: r.kind,
    inOrganization: r.kind === 'JOIN_ORGANIZATION' ? true : f.inOrganization,
    legalForm,
    hasQualification: n(f.coachQualification) !== null,
    refereeCategoryCode: n(f.refereeCategoryCode),
    organizationId: n(f.organizationId),
    coachId: n(f.coachId),
    lastName: n(f.lastName),
    firstName: n(f.firstName),
    birthDate: n(f.birthDate),
    gender: n(f.gender),
    phone: n(f.phone),
    contactEmail: n(f.contactEmail),
    telegram: n(f.telegram),
    contactChannels: f.contactChannels,
    organization:
      r.role === 'ORGANIZATION_HEAD'
        ? {
            name: n(f.org.name),
            shortName: n(f.org.shortName),
            type: n(f.org.type) as OnboardingOrganizationType | null,
            legalForm,
            countryCode: n(f.org.countryCode),
            regionId: n(f.org.regionId),
            city: n(f.org.city),
            inn: legalForm === 'RU_LEGAL_ENTITY' ? n(f.org.inn) : null,
            ogrn: legalForm === 'RU_LEGAL_ENTITY' ? n(f.org.ogrn) : null,
            legalName: legalForm === 'RU_LEGAL_ENTITY' ? n(f.org.legalName) : null,
            legalAddress: legalForm === 'RU_LEGAL_ENTITY' ? n(f.org.legalAddress) : null,
          }
        : null,
    documentTypes: r.documents.map((d) => d.typeCode),
  };
}

export type StepId = 'scenario' | 'personal' | 'documents' | 'contacts' | 'review';

export function stepsOf(r: OnboardingRequestDto): StepId[] {
  return r.kind === 'JOIN_ORGANIZATION'
    ? ['scenario', 'review']
    : ['scenario', 'personal', 'documents', 'contacts', 'review'];
}

const SCENARIO_PATHS = new Set([
  'kind',
  'inOrganization',
  'organizationId',
  'coachId',
  'refereeCategoryCode',
  'organization.type',
  'organization.legalForm',
]);

/** Шаг формы, на котором исправляется поле. */
export function stepOfPath(path: string): StepId {
  if (SCENARIO_PATHS.has(path)) return 'scenario';
  if (path.startsWith('documents.')) return 'documents';
  if (path === 'contactChannels' || path === 'telegram') return 'contacts';
  return 'personal';
}
