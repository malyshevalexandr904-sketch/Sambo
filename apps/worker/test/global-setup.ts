// Перед интеграционными тестами worker: схема БД по миграциям (без удаления — её пересоздают тесты api,
// а задачи test:integration выполняются по одной).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const TEST_DB = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://sde_app:sde_dev_app@localhost:5432/sde_test',
  DATABASE_ADMIN_URL:
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://sde:sde_dev_owner@localhost:5432/sde_test',
};

export default function setup(): void {
  const dbPackage = path.resolve(__dirname, '..', '..', '..', 'packages', 'db');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, ...TEST_DB },
    stdio: 'pipe',
  });
}
