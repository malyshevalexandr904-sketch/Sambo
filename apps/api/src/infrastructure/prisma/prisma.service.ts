import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient, type Tx } from '@sde/db';
import type { Env } from '@sde/server-kit';
import { ENV } from '../../config/config.module';

/**
 * Клиент БД под ролью приложения (DML без DDL, DATABASE.md, 10).
 * Каждая команда — одна интерактивная транзакция: изменение + AuditLog + OutboxEvent (ARCHITECTURE.md, 10).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ datasourceUrl: env.DATABASE_URL, log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** READ COMMITTED + явные блокировки там, где нужны. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 15_000 });
  }
}
