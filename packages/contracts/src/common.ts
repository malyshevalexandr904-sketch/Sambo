// Общие типы схем (API.md, 1.10).
import { z } from 'zod';

export const Uuid = z.uuid({ error: 'invalid_uuid' });

export const LocalDate = z.iso.date({ error: 'invalid_date' });

export const Instant = z.iso.datetime({ error: 'invalid_instant' });

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'invalid_email' }).max(254, { error: 'too_long' }));

export const Password = z
  .string()
  .min(10, { error: 'password_too_short' })
  .max(128, { error: 'password_too_long' });

export const PersonName = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(60, { error: 'too_long' })
  .regex(/^[\p{L}][\p{L} '’-]*$/u, { error: 'invalid_name' });

export const Grams = z.number().int().min(10_000).max(250_000);

export const LOCALES = ['ru', 'en'] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

const IANA_ZONES: ReadonlySet<string> | null = (() => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return typeof intl.supportedValuesOf === 'function'
    ? new Set([...intl.supportedValuesOf('timeZone'), 'UTC'])
    : null;
})();

export const Timezone = z.string().refine((tz) => (IANA_ZONES ? IANA_ZONES.has(tz) : tz.length > 0), {
  error: 'invalid_timezone',
});

export const Slug = z.string().regex(/^[a-z0-9-]{3,80}$/, { error: 'invalid_slug' });

export const Reason = z.string().trim().min(5, { error: 'reason_too_short' }).max(500, { error: 'too_long' });

export const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, { error: 'invalid_phone' });

export const CountryCode = z
  .string()
  .length(2, { error: 'invalid_country' })
  .transform((v) => v.toUpperCase());

export const Cursor = z.string().min(1).max(500);

/** Заголовок идемпотентности (API.md, 1.5): UUID, ответ хранится 24 часа по (userId, ключ). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const PageQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Page<T> {
  data: T[];
  page: PageInfo;
}

export interface DataEnvelope<T> {
  data: T;
}

/** Локализуемый текст справочника (API.md, 1.2). */
export interface LocalizedText {
  ru: string;
  en: string;
}

/** Маска IP для отображения: 203.0.113.* / 2001:db8:*. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.*';
  const parts = ip.split(':').filter(Boolean);
  return parts.slice(0, 2).join(':') + ':*';
}
