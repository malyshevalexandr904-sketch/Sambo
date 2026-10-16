// Представление заявки на регистрацию (Phase 9a). Заявитель видит свою заявку целиком; проверяющий — ещё и
// заявителя, и число возможных дублей человека.
import {
  type ContactChannel,
  documentRulesFor,
  type OnboardingAction,
  type OnboardingDocumentRule,
  type OnboardingHistoryDto,
  type OnboardingRequestDto,
  type OnboardingScenario,
  publicName,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';

export const ONBOARDING_INCLUDE = {
  organization: { select: { id: true, name: true, shortName: true } },
  coach: { select: { id: true, person: { select: { lastName: true, firstName: true } } } },
  documents: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: 'asc' },
    include: { file: { select: { originalName: true, mimeType: true, sizeBytes: true } } },
  },
  user: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.OnboardingRequestInclude;

export type OnboardingRow = Prisma.OnboardingRequestGetPayload<{ include: typeof ONBOARDING_INCLUDE }>;

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function scenarioOf(r: OnboardingRow): OnboardingScenario {
  return {
    role: r.role,
    kind: r.kind,
    inOrganization: r.inOrganization,
    legalForm: r.orgLegalForm,
    hasQualification: !!r.coachQualification,
    refereeCategoryCode: r.refereeCategoryCode,
  };
}

export interface MapOptions {
  rules: readonly OnboardingDocumentRule[];
  actions: OnboardingAction[];
  /** Проверяющему: заявитель и возможные дубли. */
  reviewer: { possibleDuplicates: number } | null;
}

export function toOnboardingDto(r: OnboardingRow, opts: MapOptions): OnboardingRequestDto {
  const isHead = r.role === 'ORGANIZATION_HEAD';
  return {
    id: r.id,
    role: r.role,
    kind: r.kind,
    status: r.status,
    inOrganization: r.inOrganization,
    organization: r.organization,
    coach: r.coach
      ? { id: r.coach.id, publicName: publicName(r.coach.person.lastName, r.coach.person.firstName) }
      : null,
    lastName: r.lastName,
    firstName: r.firstName,
    middleName: r.middleName,
    birthDate: dateOnly(r.birthDate),
    gender: r.gender,
    phone: r.phone,
    contactEmail: r.contactEmail,
    telegram: r.telegram,
    contactChannels: r.contactChannels as ContactChannel[],
    coachQualification: r.coachQualification,
    refereeCategoryCode: r.refereeCategoryCode,
    newOrganization: isHead
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
    documents: r.documents.map((d) => ({
      id: d.id,
      typeCode: d.typeCode,
      fileName: d.file.originalName,
      mimeType: d.file.mimeType,
      sizeBytes: Number(d.file.sizeBytes),
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    documentRules: documentRulesFor(opts.rules, scenarioOf(r)),
    decisionReason: r.decisionReason,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    resultOrganizationId: r.resultOrganizationId,
    applicant: opts.reviewer
      ? { userId: r.user.id, displayName: r.user.displayName, email: r.user.email }
      : null,
    possibleDuplicates: opts.reviewer ? opts.reviewer.possibleDuplicates : null,
    allowedActions: opts.actions,
    version: r.version,
  };
}

export function toHistoryDto(h: {
  id: string;
  fromStatus: OnboardingHistoryDto['fromStatus'];
  toStatus: OnboardingHistoryDto['toStatus'];
  reason: string | null;
  createdAt: Date;
  actor: { id: string; displayName: string } | null;
}): OnboardingHistoryDto {
  return {
    id: h.id,
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    actor: h.actor,
    reason: h.reason,
    createdAt: h.createdAt.toISOString(),
  };
}
