// auth и me (API.md, 3.1–3.2).
import { z } from 'zod';
import { Email, Locale, Password, Timezone } from './common.js';
import type { RoleCode } from './roles.js';

export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'BLOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const RegisterRequest = z.object({
  email: Email,
  password: Password,
  displayName: z.string().trim().min(1).max(100),
  locale: Locale,
  acceptTerms: z.literal(true, { error: 'terms_not_accepted' }),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const TotpCode = z.string().regex(/^\d{6}$/, { error: 'invalid_totp' });
export const RecoveryCode = z.string().regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, { error: 'invalid_recovery_code' });

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(128),
  totpCode: z.union([TotpCode, RecoveryCode]).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TokenRequest = z.object({ token: z.string().min(20).max(200) });
export type TokenRequest = z.infer<typeof TokenRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(200).optional() });

export const ForgotPasswordRequest = z.object({ email: Email });

export const ResetPasswordRequest = z.object({ token: z.string().min(20).max(200), newPassword: Password });

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});

export const TotpCodeRequest = z.object({ code: TotpCode });

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipMasked: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface Grants {
  platform: RoleCode[];
  organizations: { organizationId: string; roles: RoleCode[] }[];
  competitions: { competitionId: string; roles: RoleCode[] }[];
}

export interface Me {
  id: string;
  email: string | null;
  displayName: string;
  locale: 'ru' | 'en';
  timezone: string | null;
  status: UserStatus;
  personId: string | null;
  totpEnabled: boolean;
  grants: Grants;
}

export const UpdateMeRequest = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  locale: Locale.optional(),
  timezone: Timezone.nullable().optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** Заголовок, которым Bearer-клиент просит токены в теле ответа вместо cookie. */
export const AUTH_MODE_HEADER = 'x-auth-mode';
export const CSRF_HEADER = 'x-csrf-token';
export const COOKIE_ACCESS = 'sde_at';
export const COOKIE_REFRESH = 'sde_rt';
export const COOKIE_CSRF = 'sde_csrf';

export interface BearerLoginResponse {
  me: Me;
  tokens: TokenPair;
}
