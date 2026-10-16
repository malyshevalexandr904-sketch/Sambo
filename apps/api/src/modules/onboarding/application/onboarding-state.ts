// Поля заявки как одно состояние (Phase 9a): строка БД → состояние → изменение из запроса → только поля сценария →
// данные для записи. Поля, не относящиеся к роли и ответам, не хранятся: «состою в организации: нет» очищает
// организацию и тренера, у спортсмена нет квалификации тренера и т. д.
import type {
  ContactChannel,
  OnboardingCompleteness,
  OnboardingKind,
  OnboardingOrganizationInput,
  OnboardingPatch,
  OnboardingRole,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';

export interface OnboardingState {
  inOrganization: boolean | null;
  organizationId: string | null;
  coachId: string | null;
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
  organization: OnboardingOrganizationInput | null;
}

const EMPTY_ORG: OnboardingOrganizationInput = {
  name: null,
  shortName: null,
  type: null,
  legalForm: null,
  countryCode: null,
  regionId: null,
  city: null,
  inn: null,
  ogrn: null,
  legalName: null,
  legalAddress: null,
};

export const emptyState = (): OnboardingState => ({
  inOrganization: null,
  organizationId: null,
  coachId: null,
  lastName: null,
  firstName: null,
  middleName: null,
  birthDate: null,
  gender: null,
  phone: null,
  contactEmail: null,
  telegram: null,
  contactChannels: [],
  coachQualification: null,
  refereeCategoryCode: null,
  organization: null,
});

type Row = Prisma.OnboardingRequestGetPayload<object>;

export function stateOf(r: Row): OnboardingState {
  const hasOrg = r.role === 'ORGANIZATION_HEAD';
  return {
    inOrganization: r.inOrganization,
    organizationId: r.organizationId,
    coachId: r.coachId,
    lastName: r.lastName,
    firstName: r.firstName,
    middleName: r.middleName,
    birthDate: r.birthDate ? r.birthDate.toISOString().slice(0, 10) : null,
    gender: r.gender,
    phone: r.phone,
    contactEmail: r.contactEmail,
    telegram: r.telegram,
    contactChannels: r.contactChannels as ContactChannel[],
    coachQualification: r.coachQualification,
    refereeCategoryCode: r.refereeCategoryCode,
    organization: hasOrg
      ? {
          name: r.orgName,
          shortName: r.orgShortName,
          type: r.orgType === 'NATIONAL_FEDERATION' ? null : r.orgType,
          legalForm: r.orgLegalForm,
          countryCode: r.orgCountryCode,
          regionId: r.orgRegionId,
          city: r.orgCity,
          inn: r.orgInn,
          ogrn: r.orgOgrn,
          legalName: r.orgLegalName,
          legalAddress: r.orgLegalAddress,
        }
      : null,
  };
}

/** Изменение поверх состояния: отсутствующее в запросе поле не меняется, `null` — очищает. */
export function applyPatch(state: OnboardingState, patch: OnboardingPatch): OnboardingState {
  const next: OnboardingState = { ...state };
  for (const key of Object.keys(patch) as (keyof OnboardingPatch)[]) {
    if (key === 'organization') continue;
    const value = patch[key];
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (patch.organization !== undefined) {
    next.organization =
      patch.organization === null ? null : { ...(state.organization ?? EMPTY_ORG), ...patch.organization };
  }
  return next;
}

/** Только поля сценария роли: остальные очищаются. */
export function sanitize(role: OnboardingRole, kind: OnboardingKind, s: OnboardingState): OnboardingState {
  const out: OnboardingState = { ...s };
  const withOrganization = role === 'COACH' || role === 'ATHLETE';
  if (!withOrganization) {
    out.inOrganization = null;
    out.organizationId = null;
  }
  if (kind === 'JOIN_ORGANIZATION') out.inOrganization = true;
  if (out.inOrganization === false) out.organizationId = null;
  if (role !== 'ATHLETE' || !out.organizationId) out.coachId = null;
  if (role !== 'COACH') out.coachQualification = null;
  if (role !== 'REFEREE') out.refereeCategoryCode = null;
  if (role !== 'ORGANIZATION_HEAD') out.organization = null;
  if (out.organization && out.organization.legalForm !== 'RU_LEGAL_ENTITY') {
    out.organization = { ...out.organization, inn: null, ogrn: null, legalName: null, legalAddress: null };
  }
  return out;
}

const toDate = (d: string | null): Date | null => (d ? new Date(`${d}T00:00:00.000Z`) : null);

/** Поля для записи в onboarding_request (подходят и для создания, и для изменения). */
export function dataOf(s: OnboardingState) {
  const o = s.organization;
  return {
    inOrganization: s.inOrganization,
    organizationId: s.organizationId,
    coachId: s.coachId,
    lastName: s.lastName,
    firstName: s.firstName,
    middleName: s.middleName,
    birthDate: toDate(s.birthDate),
    gender: s.gender,
    phone: s.phone,
    contactEmail: s.contactEmail,
    telegram: s.telegram,
    contactChannels: s.contactChannels,
    coachQualification: s.coachQualification,
    refereeCategoryCode: s.refereeCategoryCode,
    orgName: o?.name ?? null,
    orgShortName: o?.shortName ?? null,
    orgType: o?.type ?? null,
    orgLegalForm: o?.legalForm ?? null,
    orgCountryCode: o?.countryCode ?? null,
    orgRegionId: o?.regionId ?? null,
    orgCity: o?.city ?? null,
    orgInn: o?.inn ?? null,
    orgOgrn: o?.ogrn ?? null,
    orgLegalName: o?.legalName ?? null,
    orgLegalAddress: o?.legalAddress ?? null,
  };
}

/** Данные для проверки полноты (contracts: onboardingProblems). */
export function completenessOf(
  role: OnboardingRole,
  kind: OnboardingKind,
  s: OnboardingState,
  documentTypes: string[],
): OnboardingCompleteness {
  return {
    role,
    kind,
    inOrganization: s.inOrganization,
    legalForm: s.organization?.legalForm ?? null,
    hasQualification: !!s.coachQualification,
    refereeCategoryCode: s.refereeCategoryCode,
    organizationId: s.organizationId,
    coachId: s.coachId,
    lastName: s.lastName,
    firstName: s.firstName,
    birthDate: s.birthDate,
    gender: s.gender,
    phone: s.phone,
    contactEmail: s.contactEmail,
    telegram: s.telegram,
    contactChannels: s.contactChannels,
    organization: s.organization,
    documentTypes,
  };
}
