// Каталог кодов ошибок (API.md, 1.8–1.9; ADR-16).
// Backend бросает только коды из этого каталога; UI переводит их по ключу `errors.<CODE>`.

export const ERROR_CATEGORIES = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE_ERROR: 422,
  RATE_LIMIT_ERROR: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCategory = keyof typeof ERROR_CATEGORIES;

const codes = <C extends ErrorCategory, K extends string>(category: C, list: readonly K[]) =>
  Object.fromEntries(list.map((k) => [k, category])) as Record<K, C>;

export const ERROR_CODES = {
  ...codes('VALIDATION_ERROR', [
    'VALIDATION_FAILED',
    'VERSION_REQUIRED',
    'IDEMPOTENCY_KEY_REQUIRED',
    'INVALID_CURSOR',
    'REASON_REQUIRED',
    'UNSUPPORTED_FILE_TYPE',
    'FILE_TOO_LARGE',
    'FILE_CONTENT_MISMATCH',
  ] as const),
  ...codes('AUTHENTICATION_ERROR', [
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'TOTP_REQUIRED',
    'TOTP_INVALID',
    'TOKEN_EXPIRED',
    'REFRESH_TOKEN_INVALID',
    'REFRESH_TOKEN_REUSED',
    'MESSENGER_DATA_INVALID',
    'NODE_CREDENTIALS_INVALID',
  ] as const),
  ...codes('AUTHORIZATION_ERROR', [
    'FORBIDDEN',
    'CSRF_TOKEN_INVALID',
    'ACCOUNT_BLOCKED',
    'EMAIL_NOT_VERIFIED',
  ] as const),
  ...codes('NOT_FOUND', ['NOT_FOUND'] as const),
  ...codes('CONFLICT', [
    'VERSION_CONFLICT',
    'IDEMPOTENCY_KEY_REUSED',
    'EXPECTED_SEQ_MISMATCH',
    'ALREADY_EXISTS',
    'SLUG_TAKEN',
    'POSSIBLE_DUPLICATE',
    'WRITE_AUTHORITY_ELSEWHERE',
    'STALE_EPOCH',
  ] as const),
  ...codes('BUSINESS_RULE_ERROR', [
    'INVALID_TRANSITION',
    'TRANSITION_PRECONDITIONS_NOT_MET',
    'ORGANIZATION_HIERARCHY_CYCLE',
    'ORGANIZATION_NOT_ACTIVE',
    'ROLE_SCOPE_MISMATCH',
    'ROLE_EXCEEDS_GRANTOR',
  ] as const),
  ...codes('RATE_LIMIT_ERROR', ['RATE_LIMITED'] as const),
  ...codes('INTERNAL_ERROR', ['INTERNAL_ERROR', 'DEPENDENCY_UNAVAILABLE'] as const),
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function categoryOf(code: ErrorCode): ErrorCategory {
  return ERROR_CODES[code];
}

export function httpStatusOf(code: ErrorCode): number {
  if (code === 'DEPENDENCY_UNAVAILABLE') return 503;
  return ERROR_CATEGORIES[ERROR_CODES[code]];
}

export interface FieldError {
  path: string;
  code: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    category: ErrorCategory;
    message: string;
    details?: Record<string, unknown>;
    traceId: string;
  };
}
