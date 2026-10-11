// Публикация в живые каналы из api (ARCHITECTURE.md, 13): общий скрипт Redis из server-kit (seq, последнее
// состояние, рассылка узлам). Живые данные — не источник истины: сбой Redis не ломает команду, экраны догонят
// запасным опросом.
import { Injectable, Logger } from '@nestjs/common';
import type { LiveMessage } from '@sde/contracts';
import {
  type LivePublication,
  LivePublisher,
  LIVE_RETAIN_SECONDS,
  liveLastKey,
  liveSeqKey,
} from '@sde/server-kit';
import { RedisService } from '../../../infrastructure/redis/redis.module';

@Injectable()
export class LivePublisherService {
  private readonly logger = new Logger('LivePublisher');
  private readonly publisher: LivePublisher;

  constructor(private readonly redis: RedisService) {
    this.publisher = new LivePublisher(redis);
  }

  async publish<P>(p: LivePublication<P>): Promise<number | null> {
    try {
      return await this.publisher.publish(p);
    } catch (err) {
      this.logger.warn({ err, channel: p.channel }, 'Live publish failed');
      return null;
    }
  }

  /** Номер последнего сообщения комнаты и последнее сохранённое состояние. */
  async state(room: string): Promise<{ seq: number; last: LiveMessage | null }> {
    const [seq, last] = await this.redis.mget(liveSeqKey(room), liveLastKey(room));
    let parsed: LiveMessage | null = null;
    if (last) {
      try {
        parsed = JSON.parse(last) as LiveMessage;
      } catch {
        parsed = null;
      }
    }
    return { seq: seq ? Number(seq) : 0, last: parsed };
  }

  /** Состояние, посчитанное для подписчика, — снимком для следующих (если публикация ещё не сохранила новее). */
  async retainIfAbsent(room: string, message: LiveMessage): Promise<void> {
    await this.redis
      .set(liveLastKey(room), JSON.stringify(message), 'EX', LIVE_RETAIN_SECONDS, 'NX')
      .catch(() => undefined);
  }
}
