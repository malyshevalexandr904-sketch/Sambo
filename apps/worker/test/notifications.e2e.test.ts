// Integration (worker): уведомления по событиям outbox — получатели, лента, письмо по настройке, идемпотентность.
import { PrismaClient, uuidv7 } from '@sde/db';
import { createLogger, type Env } from '@sde/server-kit';
import type { Job, Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/email/mailer';
import type { RenderedEmail } from '../src/email/templates';
import {
  type DeliveryJob,
  NotificationConsumer,
  type NotificationJob,
} from '../src/notifications/notification.consumer';
import type { OutboxJob } from '../src/outbox/dispatcher';
import { TEST_DB } from './global-setup';

const db = new PrismaClient({ datasourceUrl: TEST_DB.DATABASE_ADMIN_URL });
const logger = createLogger('silent', 'worker-test');
const env = { APP_URL: 'https://sambo.test' } as Env;

class FakeMailer implements Mailer {
  sent: { to: string; email: RenderedEmail }[] = [];
  fail = false;
  async send(to: string, email: RenderedEmail): Promise<{ messageId: string | null }> {
    if (this.fail) throw new Error('smtp down');
    this.sent.push({ to, email });
    return { messageId: `m-${this.sent.length}` };
  }
}

class FakeQueue {
  jobs: DeliveryJob[] = [];
  async add(_name: string, data: NotificationJob): Promise<void> {
    this.jobs.push(data as DeliveryJob);
  }
}

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE sync_log, entry, application, competition_category, competition_write_lease,
    competition, outbox_event, processed_event, notification, notification_preference, document, stored_file,
    organization, "user", person CASCADE`;
});

async function user(email: string, opts: { verified?: boolean; locale?: string } = {}): Promise<string> {
  const id = uuidv7();
  await db.user.create({
    data: {
      id,
      email,
      displayName: email,
      status: 'ACTIVE',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      locale: opts.locale ?? 'ru',
    },
  });
  return id;
}

async function applicationFixture(
  submittedBy: string,
  createdBy: string,
): Promise<{ applicationId: string }> {
  const orgId = uuidv7();
  await db.organization.create({
    data: {
      id: orgId,
      type: 'CLUB',
      name: 'СК «Буревестник»',
      shortName: 'Буревестник',
      slug: `club-${orgId.slice(-12)}`,
      countryCode: 'RU',
      status: 'ACTIVE',
    },
  });
  const competitionId = uuidv7();
  await db.competition.create({
    data: {
      id: competitionId,
      slug: `c-${competitionId.slice(-12)}`,
      name: 'Первенство города',
      organizerOrganizationId: orgId,
      timezone: 'Europe/Moscow',
      startDate: new Date('2026-11-14T00:00:00Z'),
      endDate: new Date('2026-11-14T00:00:00Z'),
      registrationStartsAt: new Date('2026-10-01T00:00:00Z'),
      registrationEndsAt: new Date('2026-11-10T00:00:00Z'),
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
    },
  });
  const applicationId = uuidv7();
  await db.application.create({
    data: {
      id: applicationId,
      competitionId,
      organizationId: orgId,
      status: 'WAITING_DOCUMENTS',
      submittedAt: new Date(),
      reviewComment: 'Нет свидетельства о рождении',
      submittedByUserId: submittedBy,
      createdById: createdBy,
    },
  });
  return { applicationId };
}

async function event(type: string, payload: Record<string, string>): Promise<string> {
  const id = uuidv7();
  await db.outboxEvent.create({
    data: { id, type, aggregateType: 'Application', aggregateId: uuidv7(), payload },
  });
  return id;
}

const job = <T>(data: T, attemptsMade = 0) =>
  ({ data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<T>;

describe('notifications', () => {
  it('an application returned for correction notifies the submitter and the creator once, email by preference', async () => {
    const submitter = await user('coach@club.test');
    const creator = await user('manager@club.test', { locale: 'en' });
    const { applicationId } = await applicationFixture(submitter, creator);
    await db.notificationPreference.create({
      data: { userId: creator, type: 'application.returned', channel: 'EMAIL', enabled: false },
    });
    const mailer = new FakeMailer();
    const queue = new FakeQueue();
    const consumer = new NotificationConsumer(
      db,
      mailer,
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
    );
    const eventId = await event('registration.application_returned', { applicationId });

    await consumer.handle(
      job<OutboxJob>({ eventId, type: 'registration.application_returned', traceId: null }),
    );
    await consumer.handle(
      job<OutboxJob>({ eventId, type: 'registration.application_returned', traceId: null }),
    );
    const rows = await db.notification.findMany({
      include: { deliveries: true },
      orderBy: { userId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'application.returned')).toBe(true);
    expect(rows.map((r) => r.params)).toEqual([{ applicationId }, { applicationId }]);
    const deliveries = Object.fromEntries(
      rows.map((r) => [r.userId, r.deliveries.map((d) => `${d.channel}:${d.status}`).sort()]),
    );
    expect(deliveries[submitter]).toEqual(['EMAIL:PENDING', 'IN_APP:SENT']);
    expect(deliveries[creator]).toEqual(['EMAIL:SKIPPED', 'IN_APP:SENT']);
    expect(queue.jobs).toHaveLength(1);

    await consumer.handle(job(queue.jobs[0] as DeliveryJob));
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail?.to).toBe('coach@club.test');
    expect(mail?.email.subject).toBe('Заявка возвращена на исправление — SAMBO Digital');
    expect(mail?.email.text).toContain('Заявка СК «Буревестник» на турнир «Первенство города»');
    expect(mail?.email.text).toContain('Комментарий секретариата: Нет свидетельства о рождении');
    expect(mail?.email.text).toContain(`https://sambo.test/ru/applications/${applicationId}`);
    const sent = await db.notificationDelivery.findFirst({ where: { channel: 'EMAIL', status: 'SENT' } });
    expect(sent).toMatchObject({ attempts: 1, providerMessageId: 'm-1' });
  });

  it('entry decisions notify only on rejection; failed sending is retried, then marked failed', async () => {
    const coach = await user('coach@club.test');
    const { applicationId } = await applicationFixture(coach, coach);
    const mailer = new FakeMailer();
    const queue = new FakeQueue();
    const consumer = new NotificationConsumer(
      db,
      mailer,
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
    );
    const approvedId = await event('registration.entry_decided', { entryId: uuidv7(), decision: 'APPROVED' });
    await consumer.handle(
      job<OutboxJob>({ eventId: approvedId, type: 'registration.entry_decided', traceId: null }),
    );
    expect(await db.notification.count()).toBe(0);

    const decided = await event('registration.application_decided', { applicationId, status: 'APPROVED' });
    await consumer.handle(
      job<OutboxJob>({ eventId: decided, type: 'registration.application_decided', traceId: null }),
    );
    const [delivery] = queue.jobs;
    mailer.fail = true;
    await expect(consumer.handle(job(delivery as DeliveryJob, 0))).rejects.toThrow('smtp down');
    expect(await db.notificationDelivery.findFirst({ where: { channel: 'EMAIL' } })).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastErrorCode: 'SEND_FAILED',
    });
    await consumer.handle(job(delivery as DeliveryJob, 4));
    expect(await db.notificationDelivery.findFirst({ where: { channel: 'EMAIL' } })).toMatchObject({
      status: 'FAILED',
      attempts: 2,
    });
  });

  it('an unverified email gets only the in-app notification', async () => {
    const coach = await user('new@club.test', { verified: false });
    const { applicationId } = await applicationFixture(coach, coach);
    const queue = new FakeQueue();
    const consumer = new NotificationConsumer(
      db,
      new FakeMailer(),
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
    );
    const eventId = await event('registration.application_returned', { applicationId });
    await consumer.handle(
      job<OutboxJob>({ eventId, type: 'registration.application_returned', traceId: null }),
    );
    const deliveries = await db.notificationDelivery.findMany();
    expect(deliveries.map((d) => `${d.channel}:${d.status}`).sort()).toEqual([
      'EMAIL:SKIPPED',
      'IN_APP:SENT',
    ]);
    expect(queue.jobs).toEqual([]);
  });
});
