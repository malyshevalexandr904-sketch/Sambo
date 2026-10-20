// Аудит и outbox расчёта от имени системы (worker): те же строки, что пишут AuditService и OutboxService api.
import { EVENT_SCHEMAS } from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { RatingAuditEntry, RatingEventEntry, RatingSink } from './calculate.js';

export function systemSink(traceId: string | null): RatingSink {
  return {
    async record(tx: Tx, entry: RatingAuditEntry): Promise<void> {
      await tx.auditLog.create({
        data: {
          id: uuidv7(),
          actorType: 'SYSTEM',
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          competitionId: entry.competitionId,
          after: entry.after as Prisma.InputJsonValue,
          traceId,
        },
      });
    },
    async enqueue(tx: Tx, event: RatingEventEntry): Promise<string> {
      const id = uuidv7();
      await tx.outboxEvent.create({
        data: {
          id,
          type: event.type,
          schemaVersion: 1,
          aggregateType: event.aggregate.type,
          aggregateId: event.aggregate.id,
          competitionId: event.competitionId,
          traceId,
          payload: EVENT_SCHEMAS[event.type].parse(event.payload),
        },
      });
      return id;
    },
  };
}
