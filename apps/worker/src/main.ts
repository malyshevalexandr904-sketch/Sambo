// Worker: диспетчер outbox, очереди писем, импорта и уведомлений, регламентные задачи (ARCHITECTURE.md, 3.1).
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { createPrismaClient } from '@sde/db';
import {
  createLogger,
  type Env,
  InvalidEnvironmentError,
  LivePublisher,
  loadEnv,
  type Logger,
  webPushKeys,
} from '@sde/server-kit';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailConsumer } from './email/email.consumer';
import { createMailer } from './email/mailer';
import { ImportConsumer } from './imports/import.consumer';
import { MAINTENANCE_JOBS, Maintenance, type MaintenanceJob } from './maintenance/maintenance';
import {
  NotificationConsumer,
  type NotificationJob,
  SOON_SCAN_EVERY_MS,
} from './notifications/notification.consumer';
import { type ConsumerQueue, OutboxDispatcher, type OutboxJob } from './outbox/dispatcher';
import { WebPushTransport } from './push/web-push';

function logFailures(w: Worker, logger: Logger): void {
  w.on('failed', (job, err) =>
    logger.error({ err, queue: w.name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed'),
  );
}

/** Проверка живости worker: GET /health. */
function healthServer(port: number) {
  return createServer((req, res) => {
    const ok = req.url === '/health';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(ok ? '{"status":"ok"}' : '{}');
  }).listen(port);
}

/** Web Push (Phase 8b): ключи VAPID из окружения или из AUTH_SECRET; неверная настройка — push выключен. */
function createWebPush(env: Env, logger: Logger): WebPushTransport | null {
  try {
    return new WebPushTransport(webPushKeys(env));
  } catch (err) {
    logger.error({ err }, 'Web Push is disabled: invalid VAPID configuration');
    return null;
  }
}

/** Регламентные задачи и поминутная проверка «скоро выступает» (Phase 8b). */
async function scheduleRepeatables(
  maintenanceQueue: Queue<{ job: MaintenanceJob }>,
  notificationQueue: Queue<NotificationJob>,
): Promise<void> {
  for (const [name, schedule] of Object.entries(MAINTENANCE_JOBS)) {
    await maintenanceQueue.upsertJobScheduler(
      name,
      { every: schedule.every },
      { name, data: { job: name as MaintenanceJob } },
    );
  }
  await notificationQueue.upsertJobScheduler(
    'match-soon-scan',
    { every: SOON_SCAN_EVERY_MS },
    { name: 'soon-scan', data: { kind: 'soon-scan' }, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}

/** Хранилище файлов (S3-совместимое). */
function storageClient(env: Env): S3Client {
  return new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
  });
}

/** Очередь с повторами по экспоненте; история выполненных и упавших задач ограничена. */
function retryingQueue<T>(name: string, connection: Redis, attempts: number, delay: number): Queue<T> {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: {
      attempts,
      backoff: { type: 'exponential', delay },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
}

/** Окружение; ошибка настройки — сообщение и выход с кодом 1. */
function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (e) {
    if (e instanceof InvalidEnvironmentError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

interface Handlers {
  email: (job: Job<OutboxJob>) => Promise<void>;
  imports: (job: Job<OutboxJob>) => Promise<void>;
  notifications: (job: Job<NotificationJob>) => Promise<void>;
  maintenance: (job: Job<{ job: MaintenanceJob }>) => Promise<void>;
}

/** Обработчики очередей с их параллельностью. */
function startWorkers(connection: Redis, h: Handlers): Worker[] {
  return [
    new Worker<OutboxJob>('email', h.email, { connection, concurrency: 5 }),
    new Worker<OutboxJob>('imports', h.imports, { connection, concurrency: 2 }),
    new Worker<NotificationJob>('notifications', h.notifications, { connection, concurrency: 5 }),
    new Worker<{ job: MaintenanceJob }>('maintenance', h.maintenance, { connection, concurrency: 1 }),
  ];
}

async function main(): Promise<void> {
  const env = loadEnvOrExit();
  const logger = createLogger(env.LOG_LEVEL, 'worker');
  const db = createPrismaClient({ url: env.DATABASE_URL });
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const s3 = storageClient(env);

  const emailQueue = retryingQueue<OutboxJob>('email', connection, 5, 10_000);
  const importQueue = retryingQueue<OutboxJob>('imports', connection, 3, 5_000);
  const notificationQueue = retryingQueue<NotificationJob>('notifications', connection, 5, 10_000);
  const maintenanceQueue = new Queue<{ job: MaintenanceJob }>('maintenance', { connection });

  const mailer = createMailer(env, logger);
  const emailConsumer = new EmailConsumer(db, mailer, logger, env);
  // Новые уведомления — сразу в живой канал пользователя (Phase 8a).
  const live = new LivePublisher(connection);
  const push = createWebPush(env, logger);
  const notificationConsumer = new NotificationConsumer(db, mailer, notificationQueue, logger, env, live, {
    push,
  });
  const maintenance = new Maintenance(db, s3, env, logger);
  const importConsumer = new ImportConsumer(db, s3, env, logger);

  const workers = startWorkers(connection, {
    email: (job) => emailConsumer.handle(job),
    imports: (job) => importConsumer.handle(job),
    notifications: (job) => notificationConsumer.handle(job),
    maintenance: (job) => maintenance.run(job.data.job),
  });
  for (const w of workers) logFailures(w, logger);

  await scheduleRepeatables(maintenanceQueue, notificationQueue);

  const dispatcher = new OutboxDispatcher(
    db,
    new Map<string, ConsumerQueue>([
      ['email', emailQueue],
      ['imports', importQueue],
      ['notifications', notificationQueue],
    ]),
    logger,
  );
  dispatcher.start();

  const port = Number(process.env.WORKER_PORT ?? 4100);
  const health = healthServer(port);

  logger.info({ port }, 'Worker started');

  const shutdown = async (): Promise<void> => {
    logger.info('Worker shutting down');
    health.close();
    await dispatcher.stop();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([
      emailQueue.close(),
      importQueue.close(),
      notificationQueue.close(),
      maintenanceQueue.close(),
    ]);
    push?.close();
    await db.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
