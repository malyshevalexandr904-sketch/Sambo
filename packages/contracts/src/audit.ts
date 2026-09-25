// audit (API.md, 3.6; ARCHITECTURE.md, 11).
import { z } from 'zod';
import { Instant, PageQuery, Uuid } from './common.js';

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'NODE'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AuditLogsQuery = PageQuery.extend({
  entityType: z.string().max(60).optional(),
  entityId: Uuid.optional(),
  actorUserId: Uuid.optional(),
  action: z.string().max(100).optional(),
  competitionId: Uuid.optional(),
  from: Instant.optional(),
  to: Instant.optional(),
});
export type AuditLogsQuery = z.infer<typeof AuditLogsQuery>;

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: { type: ActorType; userId: string | null; displayName: string | null; nodeId: string | null };
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ipMasked: string | null;
  traceId: string | null;
  platformIntervention: boolean;
}

/** Каталог действий аудита Phase 2. Новые действия добавляются сюда вместе с кодом, который их пишет. */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed_admin',
  'auth.password_changed',
  'auth.password_reset',
  'auth.totp_enabled',
  'auth.totp_disabled',
  'auth.refresh_reuse_detected',
  'user.registered',
  'user.email_verified',
  'user.updated',
  'user.blocked',
  'user.unblocked',
  'user.platform_role_granted',
  'user.platform_role_revoked',
  'person.upserted',
  'organization.created',
  'organization.updated',
  'organization.status_changed',
  'organization.member_invited',
  'organization.member_joined',
  'organization.member_updated',
  'file.uploaded',
  'dictionary.upserted',
  'setting.updated',
  'athlete.created',
  'athlete.updated',
  'athlete.archived',
  'athlete.membership_added',
  'athlete.membership_ended',
  'athlete.coach_linked',
  'athlete.coach_unlinked',
  'athlete.rank_added',
  'athlete.rank_revoked',
  'athlete.merged',
  'athlete.import_created',
  'athlete.import_committed',
  'coach.created',
  'coach.updated',
  'coach.membership_added',
  'coach.membership_ended',
  'referee.created',
  'referee.updated',
  'guardian.added',
  'guardian.verified',
  'guardian.ended',
  'guardian.invited',
  'guardian.linked',
  'consent_template.created',
  'consent_template.updated',
  'consent_template.published',
  'consent.given',
  'consent.revoked',
  'ruleset.created',
  'ruleset.version_created',
  'ruleset.version_updated',
  'ruleset.version_published',
  'age_group.created',
  'age_group.updated',
  'age_group.deleted',
  'weight_category.created',
  'weight_category.updated',
  'weight_category.deleted',
  'category_template.created',
  'category_template.updated',
  'category_template.deleted',
  'document.uploaded',
  'document.status_changed',
  'document.deleted',
  'document.expired',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
