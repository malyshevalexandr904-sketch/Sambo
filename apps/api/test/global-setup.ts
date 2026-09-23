// Перед интеграционными тестами: чистая схема и все миграции с нуля (правило «миграции применяются с нуля»).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@sde/db';
import { Redis } from 'ioredis';
import { TEST_ENV } from './test-env';

export default async function setup(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_ADMIN_URL });
  try {
    await admin.$executeRaw`DROP SCHEMA IF EXISTS public CASCADE`;
    await admin.$executeRaw`CREATE SCHEMA public`;
  } finally {
    await admin.$disconnect();
  }
  const dbPackage = path.resolve(__dirname, '..', '..', '..', 'packages', 'db');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL, DATABASE_ADMIN_URL: TEST_ENV.DATABASE_ADMIN_URL },
    stdio: 'pipe',
  });
  const redis = new Redis(TEST_ENV.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
}
