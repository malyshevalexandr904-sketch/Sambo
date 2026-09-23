// Transactional outbox (ADR-08; ARCHITECTURE.md, 12): событие пишется в той же транзакции, что и изменение.
import { Inject, Injectable } from '@nestjs/common';
import {
  type EmailTemplate,
  EVENT_SCHEMAS,
  type EventPayload,
  type EventType,
  type Locale,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { deriveKey, type Env, KEY_PURPOSES, sealJson } from '@sde/server-kit';
import { RequestContextStore } from '../../../common/context/request-context';
import { ENV } from '../../../config/config.module';

export interface EnqueueEvent<T extends EventType> {
  type: T;
  aggregate: { type: string; id: string };
  payload: EventPayload<T>;
  competitionId?: string | null;
}

@Injectable()
export class OutboxService {
  async enqueue<T extends EventType>(tx: Tx, event: EnqueueEvent<T>): Promise<string> {
    const payload = EVENT_SCHEMAS[event.type].parse(event.payload) as Prisma.InputJsonValue;
    const id = uuidv7();
    await tx.outboxEvent.create({
      data: {
        id,
        type: event.type,
        schemaVersion: 1,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        competitionId: event.competitionId ?? null,
        traceId: RequestContextStore.current().traceId,
        payload,
      },
    });
    return id;
  }
}

export interface EmailRequest {
  template: EmailTemplate;
  to: string;
  userId: string | null;
  locale: Locale;
  /** Параметры шаблона, включая ссылки с одноразовыми токенами. Хранятся только зашифрованными. */
  params: Record<string, string>;
}

/**
 * Письма уходят через outbox → worker. Адрес и параметры (ссылки с токенами) запечатываются
 * AES-256-GCM: в БД нет ни открытых токенов, ни адресов в событиях.
 */
@Injectable()
export class EmailRequestService {
  private readonly key: Buffer;

  constructor(
    private readonly outbox: OutboxService,
    @Inject(ENV) env: Env,
  ) {
    this.key = deriveKey(env.AUTH_SECRET, KEY_PURPOSES.outboxSecrets);
  }

  async request(tx: Tx, email: EmailRequest): Promise<void> {
    const aggregateId = email.userId ?? uuidv7();
    await this.outbox.enqueue(tx, {
      type: 'email.requested',
      aggregate: { type: 'User', id: aggregateId },
      payload: {
        template: email.template,
        userId: email.userId,
        locale: email.locale,
        sealedParams: sealJson(this.key, { to: email.to, params: email.params }, `email:${email.template}`),
      },
    });
  }
}
