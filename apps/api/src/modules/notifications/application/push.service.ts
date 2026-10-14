// Устройства Web Push (Phase 8b; API.md, 5.8): подписка браузера пользователя, список устройств, отписка. Ключ
// VAPID — из окружения или из AUTH_SECRET (server-kit). Отправляет push worker; здесь — только учёт устройств.
import { ECDH } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_PUSH_DEVICES,
  type PushConfigDto,
  type PushDeviceDto,
  pushEndpointProblem,
  type PushSubscriptionPut,
} from '@sde/contracts';
import type { PushSubscription } from '@sde/db';
import { type Env, webPushKeys } from '@sde/server-kit';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Ключи устройства по RFC 8291: открытый ключ — точка кривой P-256 без сжатия (65 байт), секрет аутентификации —
 * 16 байт. Ключ не на кривой зашифровать нельзя никогда — такая подписка не принимается.
 */
function keysProblem(keys: PushSubscriptionPut['keys']): string | null {
  const p256dh = Buffer.from(keys.p256dh, 'base64url');
  if (p256dh.length !== 65 || p256dh[0] !== 4) return 'invalid_p256dh';
  try {
    ECDH.convertKey(p256dh, 'prime256v1');
  } catch {
    return 'invalid_p256dh';
  }
  if (Buffer.from(keys.auth, 'base64url').length !== 16) return 'invalid_auth';
  return null;
}

const toDto = (s: PushSubscription): PushDeviceDto => ({
  id: s.id,
  userAgent: s.userAgent,
  createdAt: s.createdAt.toISOString(),
  lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
});

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private readonly publicKey: string | null;

  constructor(
    private readonly db: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    let key: string | null = null;
    try {
      key = webPushKeys(env).publicKey;
    } catch (err) {
      this.logger.error({ err }, 'Web Push is disabled: invalid VAPID configuration');
    }
    this.publicKey = key;
  }

  config(): PushConfigDto {
    return { enabled: this.publicKey !== null, publicKey: this.publicKey };
  }

  /**
   * Подписать это устройство (повтор — обновление ключей и сессии). Адрес push-службы уже подписан другим
   * пользователем — устройство переходит к текущему (на нём вошёл он). `onlyIfMine` — только обновить сессию
   * своего устройства, чужое не трогать (null). Устройств больше лимита — самые давние удаляются.
   */
  async subscribe(user: AuthUser, input: PushSubscriptionPut): Promise<PushDeviceDto | null> {
    if (!this.publicKey) throw new DomainError('DEPENDENCY_UNAVAILABLE', { dependency: 'web_push' });
    const problem = pushEndpointProblem(input.endpoint) ?? keysProblem(input.keys);
    if (problem)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'endpoint', code: problem }] });
    const userAgent = RequestContextStore.current().userAgent?.slice(0, 200) ?? null;
    return this.db.tx(async (tx) => {
      const existing = await tx.pushSubscription.findUnique({ where: { endpoint: input.endpoint } });
      if (input.onlyIfMine && existing?.userId !== user.id) return null;
      const data = {
        userId: user.id,
        sessionId: user.sessionId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      };
      const saved = await tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { endpoint: input.endpoint, ...data },
        update: data,
      });
      const older = await tx.pushSubscription.findMany({
        where: { userId: user.id, id: { not: saved.id } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: MAX_PUSH_DEVICES - 1,
        select: { id: true },
      });
      if (older.length > 0)
        await tx.pushSubscription.deleteMany({ where: { id: { in: older.map((o) => o.id) } } });
      return toDto(saved);
    });
  }

  /** Отписать устройство по адресу push-службы (выход из системы, «Не получать на этом устройстве»). */
  async unsubscribe(user: AuthUser, endpoint: string): Promise<void> {
    await this.db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.db.pushSubscription.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) throw new DomainError('NOT_FOUND', { resource: 'push_subscription' });
  }

  async devices(user: AuthUser): Promise<PushDeviceDto[]> {
    const rows = await this.db.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toDto);
  }
}
