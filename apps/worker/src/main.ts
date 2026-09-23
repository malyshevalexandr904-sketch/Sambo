// Worker: диспетчер outbox, очередь писем, регламентные задачи (ARCHITECTURE.md, 3.1).
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { createPrismaClient } from '@sde/db';
import { createLogger, InvalidEnvironmentError, loadEnv } from '@sde/server-kit';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailConsumer } from './email/email.consumer';
import { createMailer } from './email/mailer';
import { MAINTENANCE_JOBS, Maintenance, type MaintenanceJob } from './maintenance/maintenance';
import { OutboxDispatcher, type OutboxJob } from './outbox/dispatcher';

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

  const emailQueue = new Queue<OutboxJob>('email', {
    connection,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  const maintenanceQueue = new Queue<{ job: MaintenanceJob }>('maintenance', { connection });

  const emailConsumer = new EmailConsumer(db, createMailer(env, logger), logger, env);
  const maintenance = new Maintenance(db, s3, env, logger);

  const workers = [
    new Worker<OutboxJob>('email', (job: Job<OutboxJob>) => emailConsumer.handle(job), { connection, concurrency: 5 }),
    new Worker<{ job: MaintenanceJob }>('maintenance', (job) => maintenance.run(job.data.job), { connection, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => logger.error({ err, queue: w.name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed'));
  }

  for (const [name, schedule] of Object.entries(MAINTENANCE_JOBS)) {
    await maintenanceQueue.upsertJobScheduler(name, { every: schedule.every }, { name, data: { job: name as MaintenanceJob } });
  }

  const dispatcher = new OutboxDispatcher(db, new Map([['email', emailQueue]]), logger);
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
    await Promise.all([emailQueue.close(), maintenanceQueue.close()]);
    await db.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
