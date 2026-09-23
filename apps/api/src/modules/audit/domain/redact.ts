// Подготовка before/after для AuditLog (ARCHITECTURE.md, 11): только изменённые поля, без ПДн и секретов.

/** Поля, значения которых в аудит не пишутся никогда: фиксируется только факт изменения. */
const REDACTED_FIELDS = new Set([
  'lastName',
  'firstName',
  'middleName',
  'birthDate',
  'email',
  'invitedEmail',
  'contactEmail',
  'contactPhone',
  'legalName',
  'inn',
  'kpp',
  'ogrn',
  'legalAddress',
  'address',
  'passwordHash',
  'secretHash',
  'totpSecretEnc',
  'totpRecoveryCodeHashes',
  'tokenHash',
  'ip',
  'userAgent',
]);

export const REDACTED = '[redacted]';

type Plain = Record<string, unknown>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return REDACTED;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Plain).map(([k, v]) => [k, REDACTED_FIELDS.has(k) ? REDACTED : normalize(v)]));
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * Разница двух состояний. Для создания передаётся before = null, для удаления after = null.
 * Служебные поля (updatedAt, version) не включаются: они меняются всегда.
 */
export function auditDiff(before: Plain | null, after: Plain | null): { before: Plain | null; after: Plain | null } {
  const skip = new Set(['updatedAt', 'createdAt', 'version']);
  if (!before || !after) {
    const pick = (o: Plain | null): Plain | null =>
      o ? Object.fromEntries(Object.entries(o).filter(([k]) => !skip.has(k)).map(([k, v]) => [k, REDACTED_FIELDS.has(k) ? REDACTED : normalize(v)])) : null;
    return { before: pick(before), after: pick(after) };
  }
  const b: Plain = {};
  const a: Plain = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.has(key) || same(before[key], after[key])) continue;
    b[key] = REDACTED_FIELDS.has(key) ? REDACTED : normalize(before[key]);
    a[key] = REDACTED_FIELDS.has(key) ? REDACTED : normalize(after[key]);
  }
  return { before: b, after: a };
}
