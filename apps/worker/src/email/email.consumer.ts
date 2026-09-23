// Потребитель `email.requested`: расшифровывает адрес и ссылки, отправляет письмо. Идемпотентен (ProcessedEvent).
import { EVENT_SCHEMAS } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';
import { deriveKey, type Env, KEY_PURPOSES, type Logger, openJson } from '@sde/server-kit';
import type { Job } from 'bullmq';
import type { OutboxJob } from '../outbox/dispatcher';
import type { Mailer } from './mailer';
import { renderEmail } from './templates';

export const EMAIL_CONSUMER = 'email-sender';

export class EmailConsumer {
  private readonly key: Buffer;

  constructor(
    private readonly db: PrismaClient,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    env: Env,
  ) {
    this.key = deriveKey(env.AUTH_SECRET, KEY_PURPOSES.outboxSecrets);
  }

  async handle(job: Job<OutboxJob>): Promise<void> {
    const { eventId, traceId } = job.data;
    const done = await this.db.processedEvent.findUnique({ where: { consumer_eventId: { consumer: EMAIL_CONSUMER, eventId } } });
    if (done) return;
    const event = await this.db.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      this.logger.warn({ eventId, traceId }, 'Email event not found');
      return;
    }
    const payload = EVENT_SCHEMAS['email.requested'].parse(event.payload);
    const secret = openJson<{ to: string; params: Record<string, string> }>(this.key, payload.sealedParams, `email:${payload.template}`);
    const rendered = renderEmail(payload.template, payload.locale, secret.params);
    const result = await this.mailer.send(secret.to, rendered);
    await this.db.processedEvent.create({ data: { consumer: EMAIL_CONSUMER, eventId } });
    this.logger.info({ eventId, traceId, template: payload.template, messageId: result.messageId }, 'Email sent');
  }
}
