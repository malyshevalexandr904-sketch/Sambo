import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@sde/server-kit';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';

/** Redis: кэш, rate limit, blocklist сессий. Потеря Redis не теряет данных (ARCHITECTURE.md, 3.1). */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 1_000, lazyConnect: false });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
