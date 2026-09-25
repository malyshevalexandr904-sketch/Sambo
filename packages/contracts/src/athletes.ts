// Спортсмены, законные представители, согласия (API.md, 4.1–4.2; DATABASE.md, 3.3).
import { z } from 'zod';
import { Email, LocalDate, type LocalizedText, PageQuery, Reason, Uuid } from './common.js';
import {
  AthletePersonInput,
  AthletePersonPatch,
  GENDERS,
  type Gender,
  PersonInput,
  type PersonDto,
  type PersonRef,
  PROFILE_STATUSES,
  type ProfileStatus,
} from './people.js';
import type { OrganizationRef } from './organizations.js';

const SportRankCode = z.string().min(2).max(40);
const OrderRef = z.string().trim().max(100);

export const AthletesQuery = PageQuery.extend({
  organizationId: Uuid.optional(),
  coachId: Uuid.optional(),
  /** Только спортсмены, у которых текущий пользователь — действующий тренер. */
  mine: z.stringbool().optional(),
  q: z.string().trim().max(100).optional(),
  birthYear: z.coerce.number().int().min(1900).max(2100).optional(),
  gender: z.enum(GENDERS).optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
});
export type AthletesQuery = z.infer<typeof AthletesQuery>;

export const RankInput = z.object({
  sportRankCode: SportRankCode,
  assignedAt: LocalDate,
  orderRef: OrderRef.optional(),
  documentId: Uuid.optional(),
});
export type RankInput = z.infer<typeof RankInput>;

export const AthleteCreate = z.object({
  person: AthletePersonInput,
  organizationId: Uuid,
  coachId: Uuid.optional(),
  rank: RankInput.omit({ documentId: true }).optional(),
  /** Похожие спортсмены найдены, но это другой человек: перечисляются все кандидаты и причина. */
  confirmNotDuplicate: z.object({ candidateIds: z.array(Uuid).min(1).max(20), reason: Reason }).optional(),
});
export type AthleteCreate = z.infer<typeof AthleteCreate>;

export const DuplicatesCheckRequest = z.object({ person: PersonInput });
export type DuplicatesCheckRequest = z.infer<typeof DuplicatesCheckRequest>;

export const AthletePatch = z
  .object({
    person: AthletePersonPatch.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((v) => v.person !== undefined || v.status !== undefined, { error: 'empty_patch' });
export type AthletePatch = z.infer<typeof AthletePatch>;

export const MembershipCreate = z.object({
  organizationId: Uuid,
  validFrom: LocalDate,
  isPrimary: z.boolean().default(true),
});
export type MembershipCreate = z.infer<typeof MembershipCreate>;

export const PeriodEnd = z.object({ validTo: LocalDate });
export type PeriodEnd = z.infer<typeof PeriodEnd>;

export const CoachLinkCreate = z.object({
  coachId: Uuid,
  validFrom: LocalDate,
  isPrimary: z.boolean().default(true),
});
export type CoachLinkCreate = z.infer<typeof CoachLinkCreate>;

export const AthleteMergeRequest = z
  .object({ sourceAthleteId: Uuid, targetAthleteId: Uuid, reason: Reason })
  .refine((v) => v.sourceAthleteId !== v.targetAthleteId, {
    error: 'same_athlete',
    path: ['targetAthleteId'],
  });
export type AthleteMergeRequest = z.infer<typeof AthleteMergeRequest>;

/** Кандидат-дубль в публичном виде (Q-04): данные чужого клуба не раскрываются. */
export interface DuplicateCandidate {
  athleteId: string;
  publicName: string;
  birthYear: number;
  clubShortName: string | null;
  regionName: LocalizedText | null;
  similarity: number;
}

export interface RankRef {
  code: string;
  name: LocalizedText;
  assignedAt: string;
}

export interface AthleteSummary {
  id: string;
  publicId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: Gender;
  status: ProfileStatus;
  club: OrganizationRef | null;
  coach: PersonRef | null;
  rankCode: string | null;
  version: number;
}

export interface AthleteMembershipDto {
  id: string;
  organization: OrganizationRef;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface CoachLinkDto {
  id: string;
  coach: PersonRef;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface RankRecordDto {
  id: string;
  sportRankCode: string;
  assignedAt: string;
  orderRef: string | null;
  documentId: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
}

// ---- Законные представители (API.md, 4.2) ----

export const GUARDIAN_RELATIONS = ['MOTHER', 'FATHER', 'LEGAL_GUARDIAN', 'OTHER'] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const GUARDIAN_VERIFICATION_BASES = ['DOCUMENT_SHOWN', 'PAPER_APPLICATION'] as const;
export type GuardianVerificationBasis = (typeof GUARDIAN_VERIFICATION_BASES)[number];

export const GuardianCreate = z.object({
  person: PersonInput,
  relation: z.enum(GUARDIAN_RELATIONS),
  /** Приглашение создать аккаунт и привязать его к записи представителя. */
  email: Email.optional(),
});
export type GuardianCreate = z.infer<typeof GuardianCreate>;

export const GuardianVerify = z.object({ basis: z.enum(GUARDIAN_VERIFICATION_BASES) });
export type GuardianVerify = z.infer<typeof GuardianVerify>;

export const GuardianInvite = z.object({ email: Email });
export type GuardianInvite = z.infer<typeof GuardianInvite>;

export interface GuardianSummary {
  id: string;
  personId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  relation: GuardianRelation;
  verifiedAt: string | null;
  verificationBasis: GuardianVerificationBasis | null;
  hasAccount: boolean;
}

// ---- Согласия (API.md, 4.2; ФЗ-152) ----

export const CONSENT_KINDS = ['PD_PROCESSING', 'PD_DISTRIBUTION', 'HEALTH_DATA'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_METHODS = ['ELECTRONIC', 'PAPER_SCAN'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type ConsentTemplateStatus = (typeof CONSENT_TEMPLATE_STATUSES)[number];

export const ConsentTemplatesQuery = z.object({
  kind: z.enum(CONSENT_KINDS).optional(),
  locale: z.enum(['ru', 'en']).optional(),
});
export type ConsentTemplatesQuery = z.infer<typeof ConsentTemplatesQuery>;

export const ConsentTemplateCreate = z.object({
  kind: z.enum(CONSENT_KINDS),
  locale: z.enum(['ru', 'en']),
  operatorName: z.string().trim().min(2).max(500),
  bodyMarkdown: z.string().trim().min(50).max(50_000),
});
export type ConsentTemplateCreate = z.infer<typeof ConsentTemplateCreate>;

export const ConsentTemplatePatch = ConsentTemplateCreate.pick({ operatorName: true, bodyMarkdown: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type ConsentTemplatePatch = z.infer<typeof ConsentTemplatePatch>;

export interface ConsentTemplateDto {
  id: string;
  kind: ConsentKind;
  version: number;
  locale: 'ru' | 'en';
  operatorName: string;
  bodyMarkdown: string;
  status: ConsentTemplateStatus;
  publishedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
}

export const ConsentCreate = z
  .object({
    templateId: Uuid,
    method: z.enum(CONSENT_METHODS),
    /** Скан бумажного согласия (документ типа CONSENT_SCAN этого спортсмена). */
    documentId: Uuid.optional(),
    /** Кто подписал бумажное согласие за несовершеннолетнего. */
    guardianId: Uuid.optional(),
    competitionId: Uuid.optional(),
  })
  .refine((v) => v.method !== 'PAPER_SCAN' || v.documentId !== undefined, {
    error: 'required',
    path: ['documentId'],
  });
export type ConsentCreate = z.infer<typeof ConsentCreate>;

export const ConsentRevoke = z.object({ reason: Reason.optional() });
export type ConsentRevoke = z.infer<typeof ConsentRevoke>;

export interface ConsentDto {
  id: string;
  kind: ConsentKind;
  template: { id: string; version: number; locale: 'ru' | 'en' };
  method: ConsentMethod;
  givenBy: { personId: string; name: string; relation: 'SELF' | 'GUARDIAN' };
  documentId: string | null;
  competitionId: string | null;
  givenAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  active: boolean;
}

export type ConsentState = 'GIVEN' | 'MISSING';
export type ConsentsStatus = Record<ConsentKind, ConsentState>;

// ---- Карточка спортсмена ----

export type AthleteRelation = 'SELF' | 'GUARDIAN';

/** Действия над спортсменом помимо permissions: согласия от своего имени (представитель, сам спортсмен 18+). */
export const ATHLETE_SELF_ACTIONS = ['consent.give', 'consent.revoke'] as const;

export interface Athlete {
  id: string;
  publicId: string;
  person: PersonDto;
  status: ProfileStatus;
  currentClub: OrganizationRef | null;
  currentCoach: PersonRef | null;
  currentRank: RankRef | null;
  memberships: AthleteMembershipDto[];
  coaches: CoachLinkDto[];
  guardians: GuardianSummary[];
  consentsStatus: ConsentsStatus;
  /** Связь текущего пользователя со спортсменом (политики SELF, GUARDIAN). */
  relation: AthleteRelation | null;
  version: number;
  allowedActions: string[];
}

/** «Мои спортсмены» законного представителя или сам спортсмен (GET /me/athletes). */
export interface MyAthlete {
  relation: AthleteRelation;
  /** Представитель подтверждён тренером: только тогда открыты данные и согласия. */
  verified: boolean;
  athleteId: string;
  publicName: string;
  birthYear: number;
  clubShortName: string | null;
  consentsStatus: ConsentsStatus | null;
}
