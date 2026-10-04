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
  'guardian.invite',
  'document.rejected',
  'competition.invite',
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
  'athlete.import_requested': z.object({ importJobId: Uuid }),
  'athlete.merged': z.object({ sourceAthleteId: Uuid, targetAthleteId: Uuid }),
  'consent.revoked': z.object({ consentId: Uuid, athleteId: Uuid, kind: z.string() }),
  'document.rejected': z.object({ documentId: Uuid }),
  // Phase 4a — турнир и заявки. Потребители (уведомления, публичные страницы) — с Phase 4b.
  'competition.published': z.object({ competitionId: Uuid }),
  'competition.status_changed': z.object({ competitionId: Uuid, from: z.string(), to: z.string() }),
  'competition.dates_changed': z.object({ competitionId: Uuid }),
  'category.status_changed': z.object({ categoryId: Uuid, from: z.string(), to: z.string() }),
  'category.merged': z.object({ targetCategoryId: Uuid, sourceCategoryIds: z.array(Uuid) }),
  'registration.application_submitted': z.object({ applicationId: Uuid }),
  'registration.application_returned': z.object({ applicationId: Uuid }),
  'registration.application_decided': z.object({ applicationId: Uuid, status: z.string() }),
  'registration.application_cancelled': z.object({ applicationId: Uuid }),
  'registration.entry_decided': z.object({ entryId: Uuid, decision: z.string() }),
  'registration.entry_withdrawn': z.object({ entryId: Uuid }),
  'registration.entry_transferred': z.object({ entryId: Uuid, fromCategoryId: Uuid, toCategoryId: Uuid }),
  // Phase 4b — источники пересчёта допуска и уведомлений.
  'document.status_changed': z.object({ documentId: Uuid, status: z.string() }),
  'consent.given': z.object({ consentId: Uuid, personId: Uuid }),
  'competition.requirements_changed': z.object({ competitionId: Uuid }),
  'checkin.updated': z.object({ athleteId: Uuid, status: z.string() }),
  'weighin.recorded': z.object({ entryId: Uuid, attemptId: Uuid, result: z.string() }),
  'medical.clearance_changed': z.object({ clearanceId: Uuid, athleteId: Uuid, status: z.string() }),
  // Phase 5a — жеребьёвка. Потребители (публичные страницы, уведомления заявителям) — Phase 8–9.
  'draw.published': z.object({ drawId: Uuid, categoryId: Uuid }),
  'draw.superseded': z.object({ drawId: Uuid, categoryId: Uuid }),
  // Phase 6 — расписание. 'schedule.changed' — пакет ручной правки после публикации: получатели (клубы
  // затронутых участников) резолвятся потребителем по matchIds, чтобы не хранить ПДн в payload; события за
  // 10 минут объединяются в одно уведомление на клуб (apps/worker/src/notifications).
  'schedule.published': z.object({ competitionId: Uuid }),
  'schedule.changed': z.object({ competitionId: Uuid, matchIds: z.array(Uuid).min(1).max(500) }),
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
