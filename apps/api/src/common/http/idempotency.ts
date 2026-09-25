// Идемпотентность команд (API.md, 1.5): `Idempotency-Key` (UUID) обязателен на отмеченных маршрутах.
// Ответ хранится 24 часа по (userId, ключ): повтор получает тот же ответ, тот же ключ с другим телом —
// IDEMPOTENCY_KEY_REUSED. Хранилище — Redis: без него повтор нельзя отличить от новой команды,
// поэтому при его недоступности команда не выполняется (DEPENDENCY_UNAVAILABLE).
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canonicalJson, IDEMPOTENCY_HEADER, Uuid } from '@sde/contracts';
import { sha256Hex } from '@sde/server-kit';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';
import { RedisService } from '../../infrastructure/redis/redis.module';
import { RequestContextStore } from '../context/request-context';
import { DomainError } from '../errors/domain-error';

const IDEMPOTENT = 'sde:idempotent';
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Маршрут требует `Idempotency-Key`. */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);

interface Stored {
  state: 'pending' | 'done';
  hash: string;
  body?: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.reflector.get<boolean | undefined>(IDEMPOTENT, context.getHandler())) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
    if (!Uuid.safeParse(key).success) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'Idempotency-Key', code: 'invalid_uuid' }],
      });
    }
    const user = RequestContextStore.current().user;
    if (!user) throw new DomainError('UNAUTHENTICATED');
    const hash = sha256Hex(`${req.method} ${req.path} ${canonicalJson(req.body ?? {})}`);
    const redisKey = `idem:${user.id}:${key.toLowerCase()}`;

    let existing: Stored | null = null;
    try {
      const pending: Stored = { state: 'pending', hash };
      const acquired = await this.redis.set(
        redisKey,
        JSON.stringify(pending),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
      if (!acquired) {
        const raw = await this.redis.get(redisKey);
        existing = raw ? (JSON.parse(raw) as Stored) : null;
      }
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', { dependency: 'redis' });
    }
    if (existing) {
      if (existing.hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
      if (existing.state === 'pending') throw new DomainError('IDEMPOTENCY_KEY_REUSED', { inProgress: true });
      context
        .switchToHttp()
        .getResponse<{ setHeader: (k: string, v: string) => void }>()
        .setHeader('Idempotent-Replayed', 'true');
      return of(existing.body);
    }
    return next.handle().pipe(
      mergeMap((body: unknown) => {
        const done: Stored = { state: 'done', hash, body };
        return from(
          this.redis
            .set(redisKey, JSON.stringify(done), 'EX', IDEMPOTENCY_TTL_SECONDS)
            .catch(() => undefined)
            .then(() => body),
        );
      }),
      // Команда не выполнилась (транзакция откатилась): ключ освобождается для повтора.
      catchError((err: unknown) =>
        from(this.redis.del(redisKey).catch(() => 0)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
