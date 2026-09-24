// Администрирование пользователей, ролей, справочников и настроек (API.md, 3.3, 3.7).
import { z } from 'zod';
import { CountryCode, type LocalizedText, PageQuery, Reason } from './common.js';
import { USER_STATUSES, type UserStatus } from './auth.js';
import { ROLE_CODES, type GrantMode, type RoleCode } from './roles.js';
import type { PermissionCode, PermissionScope } from './permissions.js';

export const AdminUsersQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(ROLE_CODES).optional(),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuery>;

export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string;
  status: UserStatus;
  locale: 'ru' | 'en';
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  totpEnabled: boolean;
  platformRoles: RoleCode[];
  organizations: { organizationId: string; organizationName: string; role: RoleCode; status: string }[];
  createdAt: string;
}

export const ReasonRequest = z.object({ reason: Reason });
export type ReasonRequest = z.infer<typeof ReasonRequest>;

export const PLATFORM_ASSIGNABLE_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN'] as const;

export const AssignPlatformRoleRequest = z.object({
  roleCode: z.enum(PLATFORM_ASSIGNABLE_ROLES),
  reason: Reason,
});
export type AssignPlatformRoleRequest = z.infer<typeof AssignPlatformRoleRequest>;

export interface RoleDto {
  code: RoleCode;
  scope: PermissionScope;
  isSystem: boolean;
  nameKey: string;
  permissions: { code: PermissionCode; mode: GrantMode }[];
}

export interface PermissionDto {
  code: PermissionCode;
  module: string;
  description: string;
  scopes: PermissionScope[];
}

// ---- Справочники ----

export const DICTIONARY_NAMES = [
  'countries',
  'regions',
  'sport-ranks',
  'referee-categories',
  'disciplines',
  'document-types',
] as const;
export type DictionaryName = (typeof DICTIONARY_NAMES)[number];

const Name = z.string().trim().min(1).max(200);

export const DOCUMENT_SENSITIVITIES = ['HEALTH', 'IDENTITY', 'GENERAL'] as const;

export const DictionaryInputs = {
  countries: z.object({ nameRu: Name, nameEn: Name }),
  regions: z.object({ countryCode: CountryCode, nameRu: Name, nameEn: Name }),
  'sport-ranks': z.object({ nameRu: Name, nameEn: Name, rankOrder: z.number().int().min(1).max(1000) }),
  'referee-categories': z.object({
    nameRu: Name,
    nameEn: Name,
    rankOrder: z.number().int().min(1).max(1000),
  }),
  disciplines: z.object({ nameRu: Name, nameEn: Name }),
  'document-types': z.object({
    nameRu: Name,
    nameEn: Name,
    sensitivity: z.enum(DOCUMENT_SENSITIVITIES),
    allowedMime: z.array(z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])).min(1),
    maxSizeBytes: z
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024),
    retentionDays: z.number().int().min(1).max(3650),
  }),
} as const satisfies Record<DictionaryName, z.ZodType>;

export const DictionaryCodeParam = z.string().regex(/^[A-Z0-9_-]{2,40}$/, { error: 'invalid_code' });

export interface CountryDto {
  code: string;
  name: LocalizedText;
}
export interface RegionDto {
  id: string;
  countryCode: string;
  code: string;
  name: LocalizedText;
}
export interface RankedDictionaryDto {
  code: string;
  name: LocalizedText;
  rankOrder: number;
}
export interface DisciplineDto {
  code: string;
  name: LocalizedText;
}
export interface DocumentTypeDto {
  code: string;
  name: LocalizedText;
  sensitivity: (typeof DOCUMENT_SENSITIVITIES)[number];
  allowedMime: string[];
  maxSizeBytes: number;
  retentionDays: number;
}

// ---- Системные настройки ----

export const SYSTEM_SETTINGS = {
  'registration.selfSignupEnabled': z.boolean(),
  'support.contactEmail': z.email().nullable(),
  'ui.maintenanceBanner': z.object({ ru: z.string().max(500), en: z.string().max(500) }).nullable(),
  'auth.leakedPasswordCheckEnabled': z.boolean(),
} as const;

export type SystemSettingKey = keyof typeof SYSTEM_SETTINGS;

export const SYSTEM_SETTING_DEFAULTS: { [K in SystemSettingKey]: z.infer<(typeof SYSTEM_SETTINGS)[K]> } = {
  'registration.selfSignupEnabled': true,
  'support.contactEmail': null,
  'ui.maintenanceBanner': null,
  'auth.leakedPasswordCheckEnabled': true,
};

export function isSystemSettingKey(value: string): value is SystemSettingKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_SETTINGS, value);
}

export const PutSettingRequest = z.object({ value: z.unknown() });

export interface SystemSettingDto {
  key: SystemSettingKey;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
  updatedById: string | null;
}
