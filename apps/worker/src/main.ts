// Worker: диспетчер outbox, очереди писем, импорта и уведомлений, регламентные задачи (ARCHITECTURE.md, 3.1).
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { createPrismaClient } from '@sde/db';
import { createLogger, InvalidEnvironmentError, loadEnv } from '@sde/server-kit';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailConsumer } from './email/email.consumer';
import { createMailer } from './email/mailer';
import { ImportConsumer } from './imports/import.consumer';
import { MAINTENANCE_JOBS, Maintenance, type MaintenanceJob } from './maintenance/maintenance';
import { NotificationConsumer, type NotificationJob } from './notifications/notification.consumer';
import { type ConsumerQueue, OutboxDispatcher, type OutboxJob } from './outbox/dispatcher';

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

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    if (e instanceof InvalidEnvironmentError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const logger = createLogger(env.LOG_LEVEL, 'worker');
  const db = createPrismaClient({ url: env.DATABASE_URL });
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const s3 = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
  });

  const emailQueue = retryingQueue<OutboxJob>('email', connection, 5, 10_000);
  const importQueue = retryingQueue<OutboxJob>('imports', connection, 3, 5_000);
  const notificationQueue = retryingQueue<NotificationJob>('notifications', connection, 5, 10_000);
  const maintenanceQueue = new Queue<{ job: MaintenanceJob }>('maintenance', { connection });

  const mailer = createMailer(env, logger);
  const emailConsumer = new EmailConsumer(db, mailer, logger, env);
  const notificationConsumer = new NotificationConsumer(db, mailer, notificationQueue, logger, env);
  const maintenance = new Maintenance(db, s3, env, logger);
  const importConsumer = new ImportConsumer(db, s3, env, logger);

  const workers = [
    new Worker<OutboxJob>('email', (job: Job<OutboxJob>) => emailConsumer.handle(job), {
      connection,
      concurrency: 5,
    }),
    new Worker<OutboxJob>('imports', (job: Job<OutboxJob>) => importConsumer.handle(job), {
      connection,
      concurrency: 2,
    }),
    new Worker<NotificationJob>(
      'notifications',
      (job: Job<NotificationJob>) => notificationConsumer.handle(job),
      {
        connection,
        concurrency: 5,
      },
    ),
    new Worker<{ job: MaintenanceJob }>('maintenance', (job) => maintenance.run(job.data.job), {
      connection,
      concurrency: 1,
    }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.error({ err, queue: w.name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed'),
    );
  }

  for (const [name, schedule] of Object.entries(MAINTENANCE_JOBS)) {
    await maintenanceQueue.upsertJobScheduler(
      name,
      { every: schedule.every },
      { name, data: { job: name as MaintenanceJob } },
    );
  }

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
  const health = createServer((req, res) => {
    const ok = req.url === '/health';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(ok ? '{"status":"ok"}' : '{}');
  }).listen(port);

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
    await db.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
