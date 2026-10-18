// Потребитель рейтинга (docs/RATING_ARCHITECTURE.md, 6.1): подтверждённый или изменённый результат схватки →
// расчёт рейтинга в отдельной транзакции (ошибка расчёта не откатывает подтверждение судьи). После расчёта
// отпускаются ожидавшие его схватки тех же спортсменов. Расчёт идемпотентен; ProcessedEvent — как у остальных
// потребителей. Регламентная задача раз в RATING_SWEEP_EVERY_MS досчитывает ожидающие (разморозка, сбои).
import { EVENT_SCHEMAS } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';
import { RatingCalculator, systemSink } from '@sde/rating';
import type { Logger } from '@sde/server-kit';
import type { Job } from 'bullmq';
import type { OutboxJob } from '../outbox/dispatcher';

export const RATING_CONSUMER = 'rating';
export const RATING_SWEEP_EVERY_MS = 5 * 60_000;

export interface RatingSweepJob {
  kind: 'sweep';
}

export type RatingJob = OutboxJob | RatingSweepJob;

const TRIGGERS = new Set(['match.result_confirmed', 'match.result_amended']);

export class RatingConsumer {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger: Logger,
  ) {}

  private calculator(traceId: string | null): RatingCalculator {
    return new RatingCalculator(
      (fn) => this.db.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 15_000 }),
      systemSink(traceId),
    );
  }

  async handle(job: Job<RatingJob>): Promise<void> {
    const data = job.data;
    if ('kind' in data) {
      await this.sweep();
      return;
    }
    await this.onEvent(data);
  }

  async onEvent({ eventId, traceId }: OutboxJob): Promise<void> {
    const done = await this.db.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: RATING_CONSUMER, eventId } },
    });
    if (done) return;
    const event = await this.db.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event || !TRIGGERS.has(event.type)) return;
    const { matchId } = EVENT_SCHEMAS['match.result_confirmed'].pick({ matchId: true }).parse(event.payload);
    const calculator = this.calculator(traceId ?? event.traceId);
    // Расчёт читает текущий вариант результата: событие о прежнем варианте вернёт уже записанный расчёт.
    const outcome = await calculator.calculate(matchId);
    if (outcome.status && outcome.status !== 'PENDING') {
      const released = await calculator.releasePending(outcome.athleteIds);
      if (released.length > 0)
        this.logger.info({ matchId, released: released.length }, 'Pending rating calculations released');
    }
    await this.db.processedEvent.create({ data: { consumer: RATING_CONSUMER, eventId } });
    if (outcome.calculationId)
      this.logger.info(
        { eventId, traceId, matchId, calculationId: outcome.calculationId, status: outcome.status },
        'Rating calculated',
      );
  }

  /** Ожидающие расчёты по порядку схваток. */
  async sweep(): Promise<number> {
    const outcomes = await this.calculator('rating:sweep').sweepPending();
    const completed = outcomes.filter((o) => o.status !== 'PENDING').length;
    if (completed > 0) this.logger.info({ completed }, 'Pending rating calculations completed');
    return completed;
  }
}
