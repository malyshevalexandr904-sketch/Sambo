// Схема окружения (раздел 49 ТЗ; SECURITY.md, 8). Приложение не стартует с неверной конфигурацией.
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const secret = (min: number) => z.string().min(min, { error: `must be at least ${min} characters` });

const base64Key32 = z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
  error: 'must be 32 bytes encoded as base64',
});

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOYMENT_MODE: z.enum(['cloud', 'venue-node']).default('cloud'),
    NODE_ID: z.uuid().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    APP_URL: z.url(),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: bool.default(false),
    COOKIE_SECURE: bool.default(true),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    JWT_SECRET: secret(32),
    JWT_KID: z.string().min(1).max(40).default('k1'),
    JWT_PREVIOUS_SECRET: secret(32).optional(),
    JWT_PREVIOUS_KID: z.string().min(1).max(40).optional(),
    AUTH_SECRET: secret(32),
    TOTP_ENCRYPTION_KEY: base64Key32,

    STORAGE_ENDPOINT: z.url(),
    STORAGE_PUBLIC_ENDPOINT: z.url().optional(),
    STORAGE_REGION: z.string().default('ru-central1'),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_BUCKET_PUBLIC: z.string().min(3),
    STORAGE_BUCKET_PRIVATE: z.string().min(3),
    STORAGE_BUCKET_GENERATED: z.string().min(3),
    STORAGE_PUBLIC_URL: z.url(),
    STORAGE_FORCE_PATH_STYLE: bool.default(false),

    EMAIL_PROVIDER: z.enum(['smtp', 'log']).default('smtp'),
    EMAIL_FROM: z.string().min(3).default('SAMBO Digital <no-reply@sambo.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    RATE_LIMIT_ENABLED: bool.default(true),

    // Phase 10 (Telegram, MAX): необязательны до включения каналов.
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    MAX_BOT_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'required when EMAIL_PROVIDER=smtp' });
    }
    if (env.DEPLOYMENT_MODE === 'venue-node' && !env.NODE_ID) {
      ctx.addIssue({ code: 'custom', path: ['NODE_ID'], message: 'required when DEPLOYMENT_MODE=venue-node' });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      if (env.EMAIL_PROVIDER === 'log') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'log provider is not allowed in production' });
      }
      if (env.JWT_SECRET === env.AUTH_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'must differ from JWT_SECRET' });
      }
    }
    if (Boolean(env.JWT_PREVIOUS_SECRET) !== Boolean(env.JWT_PREVIOUS_KID)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_PREVIOUS_KID'], message: 'set together with JWT_PREVIOUS_SECRET' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/** Проверяет окружение. Значения секретов в сообщение об ошибке не попадают — только имена переменных. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new InvalidEnvironmentError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return result.data;
}
