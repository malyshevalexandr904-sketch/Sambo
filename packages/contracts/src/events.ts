// Каталог доменных событий outbox (ARCHITECTURE.md, 12). Payload — только идентификаторы и коды, без ПДн.
import { z } from 'zod';
import { Uuid } from './common.js';

/**
 * Письма с одноразовыми ссылками. Ссылка содержит секрет, поэтому хранится в payload только
 * в зашифрованном виде (`sealedParams`, AES-256-GCM), а расшифровывает её worker при отправке.
 */
export const EMAIL_TEMPLATES = [
  'auth.verify_email',
  'auth.account_exists',
  'auth.password_reset',
  'auth.password_changed',
  'organization.invite',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EVENT_SCHEMAS = {
  'email.requested': z.object({
    template: z.enum(EMAIL_TEMPLATES),
    userId: Uuid.nullable(),
    locale: z.enum(['ru', 'en']),
    sealedParams: z.string(),
  }),
  'user.registered': z.object({ userId: Uuid }),
  'user.blocked': z.object({ userId: Uuid }),
  'organization.created': z.object({ organizationId: Uuid }),
  'organization.status_changed': z.object({ organizationId: Uuid, from: z.string(), to: z.string() }),
} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>;

export interface EventEnvelope<T extends EventType = EventType> {
  id: string;
  type: T;
  schemaVersion: number;
  occurredAt: string;
  aggregate: { type: string; id: string };
  competitionId: string | null;
  traceId: string | null;
  payload: EventPayload<T>;
}
