// Integration (worker, Phase 8b): уведомления дня соревнований — «скоро выступает» (по позиции в очереди ковра и
// настройке N, один раз, после переноса), «началась схватка», «изменилось время»; получатели (представитель, сам
// спортсмен, подписавшийся с доступом — одно уведомление на схватку; без доступа — нет) и каналы по умолчанию.
import { PrismaClient, uuidv7 } from '@sde/db';
import { createLogger, type Env, type LivePublication, type LivePublisher } from '@sde/server-kit';
import type { Job, Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/email/mailer';
import type { RenderedEmail } from '../src/email/templates';
import { soonSourceKey } from '../src/notifications/match-day';
import {
  type DeliveryJob,
  NotificationConsumer,
  type NotificationJob,
} from '../src/notifications/notification.consumer';
import type { PushTransport } from '../src/push/web-push';
import { TEST_DB } from './global-setup';
import { finish, MIN, type MatchDayWorld, matchDayWorld, TRUNCATE_MATCH_DAY } from './match-day-world';

const db = new PrismaClient({ datasourceUrl: TEST_DB.DATABASE_ADMIN_URL });
const logger = createLogger('silent', 'worker-test');
const env = { APP_URL: 'https://sambo.test' } as Env;

class FakeMailer implements Mailer {
  sent: { to: string; email: RenderedEmail }[] = [];
  async send(to: string, email: RenderedEmail): Promise<{ messageId: string | null }> {
    this.sent.push({ to, email });
    return { messageId: `m-${this.sent.length}` };
  }
}

/** Очередь с дедупликацией по jobId, getJob для дайджеста клуба (Phase 6). */
class FakeQueue {
  jobs: { name: string; data: NotificationJob; jobId?: string; delay?: number }[] = [];
  async add(name: string, data: NotificationJob, opts?: { jobId?: string; delay?: number }): Promise<void> {
    if (opts?.jobId && this.jobs.some((j) => j.jobId === opts.jobId)) return;
    this.jobs.push({ name, data, jobId: opts?.jobId, delay: opts?.delay });
  }
  async getJob(): Promise<undefined> {
    return undefined;
  }
  deliveries(kind: 'email' | 'push'): DeliveryJob[] {
    return this.jobs.filter((j) => j.name === `deliver-${kind}`).map((j) => j.data as DeliveryJob);
  }
}

class FakeLive {
  published: LivePublication<unknown>[] = [];
  async publish<P>(p: LivePublication<P>): Promise<number> {
    this.published.push(p);
    return this.published.length;
  }
}

/** Транспорт, который всё принимает: здесь важны получатели и каналы (шифрование — push-delivery.e2e). */
const acceptAll: PushTransport = { send: async () => ({ statusCode: 201 }) };

const job = <T>(data: T, name = 'job') =>
  ({ data, name, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job<T>;

let w: MatchDayWorld;
let queue: FakeQueue;
let mailer: FakeMailer;
let live: FakeLive;
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
  mailer = new FakeMailer();
  live = new FakeLive();
  consumer = new NotificationConsumer(
    db,
    mailer,
    queue as unknown as Queue<NotificationJob>,
    logger,
    env,
    live as unknown as LivePublisher,
    { push: acceptAll },
  );
});

const notifications = (type: string) =>
  db.notification.findMany({ where: { type }, include: { deliveries: true }, orderBy: { userId: 'asc' } });

async function outbox(type: string, payload: object): Promise<string> {
  const id = uuidv7();
  await db.outboxEvent.create({
    data: {
      id,
      type,
      aggregateType: 'Match',
      aggregateId: w.competitionId,
      competitionId: w.competitionId,
      payload,
    },
  });
  await consumer.handle(job({ eventId: id, type, traceId: null }));
  return id;
}

describe('match soon', () => {
  it('announces a bout once N bouts are left ahead on the mat — once per recipient', async () => {
    // N = 2: перед схваткой A–B идущая и две в очереди — рано.
    await db.competition.update({ where: { id: w.competitionId }, data: { notifyMatchesAhead: 2 } });
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(0);

    // Идущая схватка закончилась — впереди две: пора.
    await finish(db, w.running);
    await consumer.soonCheck(w.competitionId);
    await consumer.soonCheck(w.competitionId);
    const rows = await notifications('match.soon');
    const expected = [w.mother, w.selfB, w.coach].sort();
    expect(rows.map((r) => r.userId).sort()).toEqual(expected);
    expect(rows.every((r) => r.sourceEventId === soonSourceKey(w.ab))).toBe(true);
    const byUser = new Map(rows.map((r) => [r.userId, r.params as Record<string, string>]));
    // Представителю и самому — карточка своего спортсмена; тренеру (оба спортсмена схватки) — одно, на турнир.
    expect(byUser.get(w.mother)).toEqual({
      competitionId: w.competitionId,
      matchId: w.ab,
      athleteId: w.athleteA,
      entryId: w.entryA,
      ahead: '2',
    });
    expect(byUser.get(w.selfB)).toMatchObject({ athleteId: w.athleteB, ahead: '2' });
    expect(byUser.get(w.coach)).toEqual({ competitionId: w.competitionId, matchId: w.ab, ahead: '2' });
    // По умолчанию: лента и push включены, письмо — нет; push — только если есть устройство.
    for (const r of rows) {
      const ch = new Map(r.deliveries.map((d) => [d.channel, d.status]));
      expect(ch.get('IN_APP')).toBe('SENT');
      expect(ch.get('EMAIL')).toBe('SKIPPED');
      expect(ch.get('PUSH')).toBe('SKIPPED');
    }
    expect(live.published.filter((p) => (p.payload as { type: string }).type === 'match.soon')).toHaveLength(
      3,
    );

    // Сдвиг очереди после объявления не создаёт второе «скоро» по той же схватке.
    await finish(db, w.q1);
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(3);

    // Получил доступ позже (вернулся в клуб), пока схватка ещё впереди, — получает своё «скоро»; остальные — по
    // одному, как и были.
    await db.organizationMembership.updateMany({
      where: { userId: w.formerMember },
      data: { validTo: null },
    });
    await consumer.soonCheck(w.competitionId);
    const after = await notifications('match.soon');
    expect(after.map((r) => r.userId).sort()).toEqual([...expected, w.formerMember].sort());
    expect(after.find((r) => r.userId === w.formerMember)?.params).toMatchObject({ ahead: '1' });
  });

  it('two checks of the same tournament at once create each notification once and queue every delivery', async () => {
    await finish(db, w.running);
    await db.pushSubscription.create({
      data: {
        id: uuidv7(),
        userId: w.mother,
        sessionId: uuidv7(),
        endpoint: 'https://push.example.test/mother',
        p256dh: `B${'A'.repeat(86)}`,
        auth: 'A'.repeat(22),
      },
    });
    await Promise.all([consumer.soonCheck(w.competitionId), consumer.soonCheck(w.competitionId)]);
    const rows = await notifications('match.soon');
    expect(rows.map((r) => r.userId).sort()).toEqual([w.mother, w.selfB, w.coach].sort());
    // Доставка push матери поставлена, хотя уведомление могла записать «другая» проверка.
    const pushRow = rows.find((r) => r.userId === w.mother)?.deliveries.find((d) => d.channel === 'PUSH');
    expect(pushRow?.status).toBe('PENDING');
    expect(queue.deliveries('push')).toEqual([{ deliveryId: pushRow?.id }]);
  });

  it('the minute scan queues a check per tournament with a bout in the next two hours only', async () => {
    const queueOf = () => queue.jobs.filter((j) => j.name === 'soon-check').map((j) => j.jobId);
    await consumer.handle(job({ kind: 'soon-scan' }));
    expect(queueOf()).toEqual([`soon-check-${w.competitionId}`]);
    queue.jobs = [];
    await db.matchSchedule.updateMany({
      where: { competitionId: w.competitionId },
      data: { plannedAt: new Date(Date.now() + 3 * 60 * MIN) },
    });
    await consumer.handle(job({ kind: 'soon-scan' }));
    expect(queueOf()).toEqual([]);
  });

  it('respects N = 0, the 2-hour window and a move to another mat', async () => {
    await db.competition.update({ where: { id: w.competitionId }, data: { notifyMatchesAhead: 0 } });
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(0);

    await db.competition.update({ where: { id: w.competitionId }, data: { notifyMatchesAhead: 3 } });
    // Схватка B на пустой ковёр 2, но через 3 часа — вне окна: рано.
    await db.matchSchedule.update({ where: { matchId: w.late }, data: { matId: w.mat2, orderInMat: 1 } });
    await consumer.soonCheck(w.competitionId);
    expect(
      (await notifications('match.soon')).filter((r) => r.sourceEventId === soonSourceKey(w.late)),
    ).toEqual([]);
    // Перенесли на через 10 минут — следующая на ковре 2: самому B и тренеру, матери A — нет.
    await db.matchSchedule.update({
      where: { matchId: w.late },
      data: { plannedAt: new Date(Date.now() + 10 * MIN) },
    });
    await consumer.soonCheck(w.competitionId);
    const late = (await notifications('match.soon')).filter((r) => r.sourceEventId === soonSourceKey(w.late));
    expect(late.map((r) => r.userId).sort()).toEqual([w.selfB, w.coach].sort());
    expect(late.find((r) => r.userId === w.selfB)?.params).toMatchObject({
      ahead: '0',
      athleteId: w.athleteB,
    });
  });

  it('skips competitions that are not running and withdrawn athletes', async () => {
    await db.entry.update({
      where: { id: w.entryA },
      data: { status: 'WITHDRAWN', withdrawReason: 'Травма' },
    });
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(0);
    await db.entry.update({ where: { id: w.entryA }, data: { status: 'APPROVED', withdrawReason: null } });
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(3);
    await db.notification.deleteMany({});
    await db.competition.update({ where: { id: w.competitionId }, data: { status: 'FINISHED' } });
    await consumer.soonCheck(w.competitionId);
    expect(await notifications('match.soon')).toHaveLength(0);
  });

  it('follower who lost access stops getting notifications; a blocked guardian too', async () => {
    await db.organizationMembership.updateMany({
      where: { userId: w.coach },
      data: { validTo: new Date(Date.now() - 2 * 86_400_000) },
    });
    await db.user.update({ where: { id: w.mother }, data: { status: 'BLOCKED' } });
    await consumer.soonCheck(w.competitionId);
    expect((await notifications('match.soon')).map((r) => r.userId)).toEqual([w.selfB]);
  });
});

describe('match started and time changed', () => {
  it('notifies about a started bout, honours channel preferences, schedules the soon check', async () => {
    await db.notificationPreference.createMany({
      data: [
        { userId: w.selfB, type: 'match.started', channel: 'EMAIL', enabled: true },
        { userId: w.coach, type: 'match.started', channel: 'PUSH', enabled: false },
      ],
    });
    // Устройство — у тренера (push включён по умолчанию, но он выключил его для «началась»).
    await db.pushSubscription.create({
      data: {
        id: uuidv7(),
        userId: w.coach,
        sessionId: uuidv7(),
        endpoint: 'https://push.example.test/coach',
        p256dh: `B${'A'.repeat(86)}`,
        auth: 'A'.repeat(22),
      },
    });
    await db.match.update({
      where: { id: w.ab },
      data: { status: 'IN_PROGRESS', matId: w.mat1, startedAt: new Date() },
    });
    const eventId = await outbox('match.started', { matchId: w.ab, categoryId: w.categoryId });
    await consumer.handle(job({ eventId, type: 'match.started', traceId: null }));

    const rows = await notifications('match.started');
    expect(rows.map((r) => r.userId).sort()).toEqual([w.mother, w.selfB, w.coach].sort());
    const ch = (userId: string, channel: string) =>
      rows.find((r) => r.userId === userId)?.deliveries.find((d) => d.channel === channel)?.status;
    expect(ch(w.selfB, 'EMAIL')).toBe('PENDING');
    expect(ch(w.mother, 'EMAIL')).toBe('SKIPPED');
    expect(ch(w.coach, 'PUSH')).toBe('SKIPPED');
    // Проверка «скоро» по турниру — одна, отложенная.
    const checks = queue.jobs.filter((j) => j.name === 'soon-check');
    expect(checks).toEqual([
      expect.objectContaining({ jobId: `soon-check-${w.competitionId}`, delay: 2_000 }),
    ]);

    // Письмо самому спортсмену — без имён, со ссылкой на его карточку.
    const [email] = queue.deliveries('email');
    await consumer.handle(job(email as DeliveryJob, 'deliver-email'));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('petrov@athlete.test');
    expect(mailer.sent[0]?.email.text).toContain('Ковёр 1');
    expect(mailer.sent[0]?.email.text).toContain(`https://sambo.test/ru/athletes/${w.athleteB}`);
    expect(mailer.sent[0]?.email.text).not.toMatch(/Иванов|Петров/);
  });

  it('notifies about a new time for each waiting bout of the edit, not about finished ones', async () => {
    await finish(db, w.running);
    const moved = new Date(Date.now() + 40 * MIN);
    await db.matchSchedule.update({ where: { matchId: w.ab }, data: { plannedAt: moved } });
    const eventId = await outbox('schedule.changed', {
      competitionId: w.competitionId,
      matchIds: [w.ab, w.late, w.running],
    });
    const rows = await notifications('match.time_changed');
    // A–B: мать, сам B, тренер; B–соперник: сам B и тренер; закончившаяся — никому.
    expect(rows).toHaveLength(5);
    const forMatch = (matchId: string) =>
      rows.filter((r) => (r.params as Record<string, string>).matchId === matchId).map((r) => r.userId);
    expect(forMatch(w.ab).sort()).toEqual([w.mother, w.selfB, w.coach].sort());
    expect(forMatch(w.late).sort()).toEqual([w.selfB, w.coach].sort());
    expect(forMatch(w.running)).toEqual([]);
    // Повтор задачи — без дублей.
    await consumer.handle(job({ eventId, type: 'schedule.changed', traceId: null }));
    expect(await notifications('match.time_changed')).toHaveLength(5);
    // Клубу — по-прежнему сводка через 10 минут (Phase 6).
    expect(queue.jobs.some((j) => j.name === 'schedule-digest')).toBe(true);
  });

  it('tells families only about the bouts the edit marked as noticeable; the club digest still gets all', async () => {
    await outbox('schedule.changed', {
      competitionId: w.competitionId,
      matchIds: [w.ab, w.late],
      timeChangedMatchIds: [w.late],
    });
    const rows = await notifications('match.time_changed');
    expect(rows.map((r) => (r.params as Record<string, string>).matchId)).toEqual([w.late, w.late]);
    const digest = queue.jobs.find((j) => j.name === 'schedule-digest')?.data as { matchIds: string[] };
    expect(digest.matchIds.sort()).toEqual([w.ab, w.late].sort());
  });
});
