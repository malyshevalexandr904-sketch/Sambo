// AuditService.record() в транзакции изменения (ARCHITECTURE.md, 11). Откат транзакции откатывает и аудит.
import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { auditDiff } from '../domain/redact';

export interface AuditRecord {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  organizationId?: string | null;
  competitionId?: string | null;
  /** Запись в данные турнира через платформенную роль (PERMISSIONS.md, 6.7). */
  platformIntervention?: boolean;
  /** Явный актор, если действие выполняется до появления пользователя в контексте (вход, регистрация). */
  actorUserId?: string | null;
}

@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditRecord): Promise<void> {
    const ctx = RequestContextStore.current();
    const actorUserId = entry.actorUserId !== undefined ? entry.actorUserId : (ctx.user?.id ?? null);
    const diff = auditDiff(entry.before ?? null, entry.after ?? null);
    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        actorType: actorUserId ? 'USER' : 'SYSTEM',
        actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        organizationId: entry.organizationId ?? null,
        competitionId: entry.competitionId ?? null,
        before: (diff.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (diff.after ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: entry.reason ?? null,
        platformIntervention: entry.platformIntervention ?? false,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        traceId: ctx.traceId,
      },
    });
  }
}
