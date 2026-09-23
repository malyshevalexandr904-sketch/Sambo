import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { Public } from '../../access';

type Check = 'ok' | 'fail';

/** /health — процесс жив; /ready — доступны БД, Redis, S3 (ARCHITECTURE.md, 20). */
@Controller()
@Public()
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: Check; checks: Record<string, Check> }> {
    const probe = async (fn: () => Promise<unknown>): Promise<Check> => {
      try {
        await Promise.race([
          fn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
        ]);
        return 'ok';
      } catch {
        return 'fail';
      }
    };
    const checks = {
      database: await probe(() => this.db.$queryRaw`SELECT 1`),
      redis: await probe(() => this.redis.ping()),
      storage: await probe(() => this.storage.ping()),
    };
    const status: Check = Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'fail';
    res.status(status === 'ok' ? 200 : 503);
    return { status, checks };
  }
}
