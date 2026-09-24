// Настройка приложения: общая для main.ts и интеграционных тестов.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '@sde/server-kit';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AUTH_MODE_HEADER, CSRF_HEADER } from '@sde/contracts';
import { ENV } from './config/config.module';

export function configureApp(app: NestExpressApplication, opts: { useLogger: boolean }): INestApplication {
  const env = app.get<Env>(ENV);
  if (opts.useLogger) app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'If-Match',
      'Idempotency-Key',
      'X-Request-Id',
      CSRF_HEADER,
      AUTH_MODE_HEADER,
    ],
    exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After'],
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableShutdownHooks();
  return app;
}
