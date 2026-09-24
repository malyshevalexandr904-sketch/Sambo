// organizations (API.md, 3.4; DATABASE.md, 3.2).
import { z } from 'zod';
import { CountryCode, E164, Email, LocalDate, PageQuery, Slug, Uuid } from './common.js';
import { ORGANIZATION_ROLE_CODES, type RoleCode } from './roles.js';

export const ORGANIZATION_TYPES = [
  'NATIONAL_FEDERATION',
  'REGIONAL_FEDERATION',
  'CLUB',
  'SPORTS_SCHOOL',
  'ORGANIZER',
  'OTHER',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = ['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

const Inn = z.string().regex(/^(\d{10}|\d{12})$/, { error: 'invalid_inn' });

export const LegalDetailsInput = z.object({
  legalName: z.string().trim().min(2).max(300),
  inn: Inn,
  kpp: z
    .string()
    .regex(/^\d{9}$/, { error: 'invalid_kpp' })
    .optional(),
  ogrn: z
    .string()
    .regex(/^(\d{13}|\d{15})$/, { error: 'invalid_ogrn' })
    .optional(),
  legalAddress: z.string().trim().min(5).max(500),
});
export type LegalDetailsInput = z.infer<typeof LegalDetailsInput>;

const OrganizationFields = {
  type: z.enum(ORGANIZATION_TYPES),
  parentId: Uuid.nullable().optional(),
  name: z.string().trim().min(2).max(200),
  shortName: z.string().trim().min(1).max(60),
  slug: Slug.optional(),
  countryCode: CountryCode,
  regionId: Uuid.nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  contactEmail: Email.nullable().optional(),
  contactPhone: E164.nullable().optional(),
  website: z
    .url({ protocol: /^https?$/, error: 'invalid_url' })
    .max(300)
    .nullable()
    .optional(),
  logoFileId: Uuid.nullable().optional(),
  legalDetails: LegalDetailsInput.nullable().optional(),
};

export const OrganizationInput = z.object(OrganizationFields);
export type OrganizationInput = z.infer<typeof OrganizationInput>;

export const OrganizationPatch = z.object(OrganizationFields).partial();
export type OrganizationPatch = z.infer<typeof OrganizationPatch>;

export const OrganizationsQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  type: z.enum(ORGANIZATION_TYPES).optional(),
  regionId: Uuid.optional(),
  parentId: Uuid.optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
});
export type OrganizationsQuery = z.infer<typeof OrganizationsQuery>;

export const OrganizationTransitionRequest = z.object({
  to: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  reason: z.string().trim().min(5).max(500).optional(),
});
export type OrganizationTransitionRequest = z.infer<typeof OrganizationTransitionRequest>;

export interface OrganizationSummary {
  id: string;
  type: OrganizationType;
  name: string;
  shortName: string;
  slug: string;
  status: OrganizationStatus;
  parentId: string | null;
  countryCode: string;
  regionId: string | null;
  city: string | null;
  logoUrl: string | null;
}

export interface Organization extends OrganizationSummary {
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logoFileId: string | null;
  legalDetails: LegalDetailsInput | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  allowedActions: string[];
}

export const MembersQuery = PageQuery.extend({
  role: z.enum(ORGANIZATION_ROLE_CODES as [RoleCode, ...RoleCode[]]).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
});
export type MembersQuery = z.infer<typeof MembersQuery>;

export const InviteMemberRequest = z.object({
  email: Email,
  roleCode: z.enum(ORGANIZATION_ROLE_CODES as [RoleCode, ...RoleCode[]]),
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequest>;

export const MembershipPatch = z
  .object({
    status: z.enum(['SUSPENDED', 'ACTIVE', 'ENDED']).optional(),
    validTo: LocalDate.nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.validTo !== undefined, { error: 'empty_patch' });
export type MembershipPatch = z.infer<typeof MembershipPatch>;

export interface Membership {
  id: string;
  organizationId: string;
  user: { id: string; displayName: string; email: string | null } | null;
  invitedEmail: string | null;
  roleCode: RoleCode;
  status: MembershipStatus;
  validFrom: string | null;
  validTo: string | null;
  version: number;
  createdAt: string;
}

export const AcceptInviteRequest = z.object({ token: z.string().min(20).max(200) });
