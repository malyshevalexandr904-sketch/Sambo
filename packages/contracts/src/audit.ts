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
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
