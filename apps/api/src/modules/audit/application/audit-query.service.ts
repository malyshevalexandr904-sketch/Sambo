import { Injectable } from '@nestjs/common';
import { type AuditEntry, type AuditLogsQuery, maskIp, type Page } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Injectable()
export class AuditQueryService {
  constructor(private readonly db: PrismaService) {}

  async list(query: AuditLogsQuery, fixedCompetitionId?: string): Promise<Page<AuditEntry>> {
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.AuditLogWhereInput = {
      entityType: query.entityType,
      entityId: query.entityId,
      actorUserId: query.actorUserId,
      action: query.action,
      competitionId: fixedCompetitionId ?? query.competitionId,
      occurredAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    if (cursor) {
      const at = new Date(cursor.k);
      where.OR = [{ occurredAt: { lt: at } }, { occurredAt: at, id: { lt: cursor.id } }];
    }
    const rows = await this.db.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { actorUser: { select: { displayName: true } } },
    });
    return toPage(
      rows,
      query.limit,
      (r) => ({ k: r.occurredAt.toISOString(), id: r.id }),
      (r): AuditEntry => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actor: {
          type: r.actorType,
          userId: r.actorUserId,
          displayName: r.actorUser?.displayName ?? null,
          nodeId: r.nodeId,
        },
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
        reason: r.reason,
        ipMasked: maskIp(r.ip),
        traceId: r.traceId,
        platformIntervention: r.platformIntervention,
      }),
    );
  }
}
