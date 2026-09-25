// Настройка приложения: общая для main.ts и интеграционных тестов.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '@sde/server-kit';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AUTH_MODE_HEADER, CSRF_HEADER } from '@sde/contracts';
import { ENV } from './config/config.module';

const VERSION_TAG = /^\s*(W\/)?"v\d+"/;

export function configureApp(app: NestExpressApplication, opts: { useLogger: boolean }): INestApplication {
  const env = app.get<Env>(ENV);
  if (opts.useLogger) app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  // ETag версионируемого ресурса ("v{version}") — токен конкурентности для If-Match (API.md, 1.4), а не
  // валидатор кэша: производные поля (согласия, связи, allowedActions) меняются без смены версии. Поэтому
  // If-None-Match с таким токеном не даёт 304, а ответы API по умолчанию не сохраняются в кэше браузера
  // (персональные данные). Справочники задают свой Cache-Control и проверяются по ETag содержимого.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (VERSION_TAG.test(req.headers['if-none-match'] ?? '')) delete req.headers['if-none-match'];
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
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
