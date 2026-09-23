// Диспетчер outbox (ADR-08; ARCHITECTURE.md, 12): забирает события из PostgreSQL и ставит задачи
// потребителям в BullMQ. Несколько экземпляров worker не мешают друг другу: FOR UPDATE SKIP LOCKED.
import type { EventType } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';
import type { Logger } from '@sde/server-kit';
import type { Queue } from 'bullmq';

export interface OutboxJob {
  eventId: string;
  type: string;
  traceId: string | null;
}

/** Потребители событий: событие → очереди. События без потребителей просто помечаются отправленными. */
export const CONSUMERS: Partial<Record<EventType, readonly string[]>> = {
  'email.requested': ['email'],
};

const MAX_ATTEMPTS = 10;
const BATCH = 50;

interface Row {
  id: string;
  type: string;
  trace_id: string | null;
  attempts: number;
}

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly queues: Map<string, Queue<OutboxJob>>,
    private readonly logger: Logger,
    private readonly intervalMs = 1_000,
  ) {}

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.running) return;
      this.running = true;
      try {
        while ((await this.dispatchBatch()) === BATCH) {
          // Есть ещё события — продолжаем без паузы.
        }
      } catch (e) {
        this.logger.error({ err: e }, 'Outbox dispatch failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  /** Возвращает число обработанных событий. */
  async dispatchBatch(): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`
        SELECT id, type, trace_id, attempts FROM outbox_event
        WHERE status = 'PENDING' AND available_at <= now()
        ORDER BY occurred_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        try {
          for (const queueName of CONSUMERS[row.type as EventType] ?? []) {
            const queue = this.queues.get(queueName);
            if (!queue) throw new Error(`Queue ${queueName} is not configured`);
            // jobId = eventId: повторная постановка того же события не создаёт дубль задачи.
            await queue.add(
              row.type,
              { eventId: row.id, type: row.type, traceId: row.trace_id },
              { jobId: `${queueName}-${row.id}` },
            );
          }
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { status: 'DISPATCHED', dispatchedAt: new Date(), attempts: { increment: 1 } },
          });
        } catch (e) {
          const attempts = row.attempts + 1;
          const backoffMs = Math.min(2 ** attempts * 1_000, 5 * 60_000);
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: e instanceof Error ? e.message.slice(0, 500) : 'unknown',
              status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
              availableAt: new Date(Date.now() + backoffMs),
            },
          });
          this.logger.warn(
            { eventId: row.id, type: row.type, attempts, traceId: row.trace_id },
            'Outbox event dispatch failed',
          );
        }
      }
      return rows.length;
    });
  }
}
