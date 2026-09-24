// Окружение интеграционных тестов: реальные PostgreSQL и Redis (IMPLEMENTATION_PLAN, 4).
// В CI адреса приходят из переменных TEST_*, локально — значения по умолчанию.
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://sde_app:sde_dev_app@localhost:5432/sde_test',
  DATABASE_ADMIN_URL:
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://sde:sde_dev_owner@localhost:5432/sde_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop',
  JWT_KID: 't1',
  AUTH_SECRET: 'test-auth-secret-0123456789abcdefghijklmn',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORAGE_ENDPOINT: 'http://storage.test',
  STORAGE_ACCESS_KEY: 'test',
  STORAGE_SECRET_KEY: 'test',
  STORAGE_BUCKET_PUBLIC: 'test-public',
  STORAGE_BUCKET_PRIVATE: 'test-private',
  STORAGE_BUCKET_GENERATED: 'test-generated',
  STORAGE_PUBLIC_URL: 'http://storage.test/test-public',
  EMAIL_PROVIDER: 'log',
  COOKIE_SECURE: 'false',
  RATE_LIMIT_ENABLED: 'false',
} satisfies Record<string, string>;

export function applyTestEnv(): void {
  for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
}
