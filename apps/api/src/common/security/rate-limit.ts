// Rate limiting на Redis (API.md, 1.7). Фиксированное окно; превышение → 429 RATE_LIMITED + Retry-After.
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Env } from '@sde/server-kit';
import { sha256Hex } from '@sde/server-kit';
import type { Request } from 'express';
import { ENV } from '../../config/config.module';
import { RedisService } from '../../infrastructure/redis/redis.module';
import { RequestContextStore } from '../context/request-context';
import { DomainError } from '../errors/domain-error';

export const RATE_LIMITS = {
  /** Вход, регистрация, восстановление пароля: по IP. */
  auth: { limit: 10, windowSeconds: 60 },
  /** Те же операции: дополнительно по email (проверяется в сервисе). */
  authEmail: { limit: 5, windowSeconds: 60 },
  /** Внутренний API: по пользователю (или IP для анонимных). */
  api: { limit: 600, windowSeconds: 60 },
  /** Загрузка файлов: по пользователю. */
  upload: { limit: 30, windowSeconds: 60 },
} as const;

export type RateLimitGroup = keyof typeof RATE_LIMITS;

const RATE_LIMIT_GROUP = 'sde:rate-limit-group';

/** Группа лимита маршрута; по умолчанию — `api`. */
export const RateLimit = (group: RateLimitGroup): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_GROUP, group);

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Учитывает попытку. Недоступность Redis не блокирует работу (fail-open с предупреждением в лог). */
  async hit(group: RateLimitGroup, key: string): Promise<void> {
    if (!this.env.RATE_LIMIT_ENABLED) return;
    const { limit, windowSeconds } = RATE_LIMITS[group];
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const redisKey = `rl:${group}:${sha256Hex(key).slice(0, 32)}:${window}`;
    let count: number;
    try {
      const res = await this.redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds + 1)
        .exec();
      count = Number(res?.[0]?.[1] ?? 0);
    } catch (e) {
      this.logger.warn({ err: e, group }, 'Rate limiter unavailable');
      return;
    }
    if (count > limit) {
      const retryAfterSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
      throw new DomainError('RATE_LIMITED', { retryAfterSeconds });
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const group =
      this.reflector.getAllAndOverride<RateLimitGroup | undefined>(RATE_LIMIT_GROUP, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'api';
    const req = context.switchToHttp().getRequest<Request>();
    const user = RequestContextStore.current().user;
    const subject = group === 'auth' || !user ? `ip:${req.ip ?? 'unknown'}` : `user:${user.id}`;
    await this.limiter.hit(group, subject);
    return true;
  }
}
