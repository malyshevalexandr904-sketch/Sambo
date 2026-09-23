import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv, loggerOptions } from '@sde/server-kit';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { RequestContextMiddleware, TRACE_ID_RE } from './common/context/request-context.middleware';
import { RequestContextStore } from './common/context/request-context';
import { AllExceptionsFilter } from './common/errors/exception.filter';
import { CsrfGuard } from './common/security/csrf';
import { RateLimitGuard } from './common/security/rate-limit';
import { SecurityModule } from './common/security/security.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AccessModule, PermissionGuard } from './modules/access';
import { AdminModule } from './modules/admin';
import { AuditModule } from './modules/audit';
import { AuthGuard, AuthModule } from './modules/auth';
import { DictionariesModule } from './modules/dictionaries';
import { FilesModule } from './modules/files';
import { HealthModule } from './modules/health';
import { OrganizationsModule } from './modules/organizations';
import { OutboxModule } from './modules/outbox';
import { SettingsModule } from './modules/settings';
import { UsersModule } from './modules/users';

const logLevel = process.env.LOG_LEVEL ?? 'info';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        ...loggerOptions(logLevel, 'api'),
        // traceId = X-Request-Id прокси или новый UUID; RequestContextMiddleware берёт тот же req.id.
        genReqId: (req: IncomingMessage) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && TRACE_ID_RE.test(incoming) ? incoming : randomUUID();
        },
        customProps: () => {
          const ctx = RequestContextStore.get();
          return { traceId: ctx?.traceId, userId: ctx?.user?.id };
        },
        autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' || req.url === '/ready' },
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    SecurityModule,
    AccessModule,
    AuditModule,
    OutboxModule,
    SettingsModule,
    UsersModule,
    AuthModule,
    FilesModule,
    OrganizationsModule,
    AdminModule,
    DictionariesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Порядок guards — конвейер ARCHITECTURE.md, 5.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}

/** Проверка окружения до создания приложения: неверная конфигурация — отказ старта. */
export function assertEnvironment(): void {
  loadEnv();
}
