// Integration (worker, Phase 8b): доставка Web Push — сообщение шифруется ключами устройства (тестовое «устройство»
// расшифровывает его само, RFC 8291), запрос подписан VAPID (RFC 8292); без имён детей; только устройства с живой
// сессией входа; 404/410 — подписка удаляется; сбой push-службы — повтор, последняя попытка — FAILED.
import type { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@sde/db';
import { createLogger, type Env } from '@sde/server-kit';
import type { Job, Queue } from 'bullmq';
import webpush from 'web-push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/email/mailer';
import {
  type DeliveryJob,
  NotificationConsumer,
  type NotificationJob,
} from '../src/notifications/notification.consumer';
import { Maintenance } from '../src/maintenance/maintenance';
import { PushTransientError } from '../src/push/push-delivery';
import { type PushRequest, WebPushTransport } from '../src/push/web-push';
import { TEST_DB } from './global-setup';
import {
  finish,
  loginSession,
  type MatchDayWorld,
  matchDayWorld,
  TestPushDevice,
  TRUNCATE_MATCH_DAY,
  verifyVapid,
} from './match-day-world';

const db = new PrismaClient({ datasourceUrl: TEST_DB.DATABASE_ADMIN_URL });
const logger = createLogger('silent', 'worker-test');
const env = { APP_URL: 'https://sambo.test' } as Env;
const mailer: Mailer = { send: async () => ({ messageId: null }) };

class FakeQueue {
  jobs: { name: string; data: NotificationJob }[] = [];
  async add(name: string, data: NotificationJob): Promise<void> {
    this.jobs.push({ name, data });
  }
  async getJob(): Promise<undefined> {
    return undefined;
  }
  push(): DeliveryJob[] {
    return this.jobs.filter((j) => j.name === 'deliver-push').map((j) => j.data as DeliveryJob);
  }
}

const vapid = webpush.generateVAPIDKeys();
const keys = { ...vapid, subject: 'mailto:push@sambo.test' };

/** «Push-служба»: запоминает запросы, отвечает по адресу подписки. */
class FakePushService {
  requests: PushRequest[] = [];
  status = new Map<string, number>();
  readonly requester = async (req: PushRequest) => {
    this.requests.push(req);
    return { statusCode: this.status.get(req.endpoint) ?? 201 };
  };
}

const job = (data: DeliveryJob, attemptsMade = 0) =>
  ({ data, name: 'deliver-push', attemptsMade, opts: { attempts: 5 } }) as unknown as Job<DeliveryJob>;

let w: MatchDayWorld;
let queue: FakeQueue;
let service: FakePushService;
let consumer: NotificationConsumer;

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRawUnsafe(TRUNCATE_MATCH_DAY);
  w = await matchDayWorld(db);
  queue = new FakeQueue();
  service = new FakePushService();
  consumer = new NotificationConsumer(db, mailer, queue as unknown as Queue<NotificationJob>, logger, env, null, {
    push: new WebPushTransport(keys, service.requester),
  });
});

const pushDelivery = async (userId: string) =>
  db.notificationDelivery.findFirstOrThrow({ where: { channel: 'PUSH', notification: { userId } } });

describe('web push delivery', () => {
  it('encrypts for the device, signs with VAPID, never shows the child name; dead devices are removed', async () => {
    const phone = new TestPushDevice('https://push.example.test/send/phone');
    const loggedOut = new TestPushDevice('https://push.example.test/send/old-laptop');
    const gone = new TestPushDevice('https://push.example.test/send/reinstalled');
    await phone.subscribe(db, w.mother, await loginSession(db, w.mother));
    await loggedOut.subscribe(db, w.mother, await loginSession(db, w.mother, true));
    await gone.subscribe(db, w.mother, await loginSession(db, w.mother));
    service.status.set(gone.endpoint, 410);

    await finish(db, w.running);
    await consumer.soonCheck(w.competitionId);
    const [delivery, ...others] = queue.push();
    expect(others).toEqual([]); // push-устройства только у матери
    await consumer.handle(job(delivery as DeliveryJob));

    // Ушло на телефон и на переустановленный браузер; после выхода — ничего.
    expect(service.requests.map((r) => r.endpoint).sort()).toEqual([gone.endpoint, phone.endpoint].sort());
    const req = service.requests.find((r) => r.endpoint === phone.endpoint) as PushRequest;
    const message = JSON.parse(phone.decrypt(req.body)) as Record<string, unknown>;
    expect(message).toEqual({
      v: 1,
      title: 'Скоро схватка',
      body: expect.stringMatching(/^Ковёр 1 · через 2 схватки · схватка № \d+ · Кубок ковра$/),
      url: `/ru/athletes/${w.athleteA}`,
      tag: `match.soon:${w.ab}`,
    });
    expect(JSON.stringify(message)).not.toMatch(/Иванов|Петров/);
    expect(() => gone.decrypt(req.body)).toThrow(); // чужое устройство не прочитает

    expect(req.headers).toMatchObject({
      TTL: 3600,
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
    });
    expect(String(req.headers.Topic)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    const claims = verifyVapid(String(req.headers.Authorization), keys.publicKey);
    expect(claims.aud).toBe('https://push.example.test');
    expect(claims.sub).toBe('mailto:push@sambo.test');
    expect(Number(claims.exp) * 1000).toBeLessThanOrEqual(Date.now() + 24 * 3600_000);

    expect(await pushDelivery(w.mother)).toMatchObject({ status: 'SENT', attempts: 1 });
    const left = await db.pushSubscription.findMany({ where: { userId: w.mother } });
    expect(left.map((s) => s.endpoint)).toEqual([phone.endpoint]);
    expect(left[0]?.lastUsedAt).not.toBeNull();

    // Повтор той же задачи (доставка уже SENT) ничего не отправляет.
    await consumer.handle(job(delivery as DeliveryJob));
    expect(service.requests).toHaveLength(2);
  });

  it('retries when the push service fails; the last attempt marks the delivery failed', async () => {
    const tablet = new TestPushDevice('https://push.example.test/send/tablet');
    await tablet.subscribe(db, w.selfB, await loginSession(db, w.selfB));
    service.status.set(tablet.endpoint, 503);
    await finish(db, w.running);
    await consumer.soonCheck(w.competitionId);
    const [delivery] = queue.push();

    await expect(consumer.handle(job(delivery as DeliveryJob))).rejects.toBeInstanceOf(PushTransientError);
    expect(await pushDelivery(w.selfB)).toMatchObject({ status: 'PENDING', attempts: 1 });
    await expect(consumer.handle(job(delivery as DeliveryJob, 4))).resolves.toBeUndefined();
    expect(await pushDelivery(w.selfB)).toMatchObject({ status: 'FAILED', lastErrorCode: 'SEND_FAILED' });
    // Подписка остаётся: сбой временный.
    expect(await db.pushSubscription.count({ where: { userId: w.selfB } })).toBe(1);
  });

  it('a device whose session ended gets nothing; an internal push address is rejected and removed', async () => {
    const old = new TestPushDevice('https://push.example.test/send/after-logout');
    await old.subscribe(db, w.selfB, await loginSession(db, w.selfB, true));
    const internal = new TestPushDevice('https://127.0.0.1/send/x');
    await db.pushSubscription.create({
      data: {
        id: '01920000-0000-7000-8000-000000000001',
        userId: w.coach,
        sessionId: await loginSession(db, w.coach),
        endpoint: internal.endpoint,
        ...internal.keys,
      },
    });
    await finish(db, w.running);
    await consumer.soonCheck(w.competitionId);
    for (const d of queue.push()) await consumer.handle(job(d));
    expect(service.requests).toEqual([]);
    expect(await pushDelivery(w.selfB)).toMatchObject({ status: 'SKIPPED', lastErrorCode: 'NO_DEVICES' });
    expect(await pushDelivery(w.coach)).toMatchObject({ status: 'SKIPPED', lastErrorCode: 'NO_DEVICES' });
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it('daily cleanup removes subscriptions of ended sessions and keeps live ones', async () => {
    const live = new TestPushDevice('https://push.example.test/send/live');
    const ended = new TestPushDevice('https://push.example.test/send/ended');
    await live.subscribe(db, w.mother, await loginSession(db, w.mother));
    await ended.subscribe(db, w.mother, await loginSession(db, w.mother, true));
    await new Maintenance(db, {} as S3Client, env, logger).run('cleanupTokens');
    const left = await db.pushSubscription.findMany({ select: { endpoint: true } });
    expect(left).toEqual([{ endpoint: live.endpoint }]);
  });
});
