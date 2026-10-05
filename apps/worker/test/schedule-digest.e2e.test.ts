// Integration (worker): дайджест изменений расписания клубу (ARCHITECTURE.md 14.6; план Phase 6, §4) — событие
// schedule.changed не уведомляет сразу, а копится по клубу на 10 минут (несколько пакетов правки — одно письмо),
// и уходит только затронутым клубам, не всем участникам турнира. API-тест (apps/api scheduling.e2e.test.ts)
// проверяет, что событие попадает в outbox; этот тест — что из него получается настоящее уведомление и письмо.
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
  type ScheduleDigestJob,
} from '../src/notifications/notification.consumer';
import type { OutboxJob } from '../src/outbox/dispatcher';
import { TEST_DB } from './global-setup';

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

interface FakeJobEntry {
  data: NotificationJob;
  delayMs: number;
}

/** Очередь с дедупликацией по jobId и поддержкой getJob/updateData/isDelayed — как у дайджеста в BullMQ. */
class FakeQueue {
  private readonly byId = new Map<string, FakeJobEntry>();
  private readonly order: FakeJobEntry[] = [];
  async add(_name: string, data: NotificationJob, opts?: { jobId?: string; delay?: number }): Promise<void> {
    if (opts?.jobId && this.byId.has(opts.jobId)) return;
    const entry: FakeJobEntry = { data, delayMs: opts?.delay ?? 0 };
    if (opts?.jobId) this.byId.set(opts.jobId, entry);
    this.order.push(entry);
  }
  async getJob(jobId: string) {
    const entry = this.byId.get(jobId);
    if (!entry) return undefined;
    return {
      data: entry.data,
      isDelayed: async () => entry.delayMs > 0,
      updateData: async (newData: NotificationJob) => {
        entry.data = newData;
      },
    } as unknown as Job<NotificationJob>;
  }
  get jobs(): NotificationJob[] {
    return this.order.map((e) => e.data);
  }
}

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE sync_log, match_participant, match, entry, application, competition_category,
    competition_write_lease, competition, outbox_event, processed_event, notification, notification_preference,
    athlete_profile, organization_membership, organization, "user", person CASCADE`;
});

async function club(name: string): Promise<string> {
  const id = uuidv7();
  await db.organization.create({
    data: {
      id,
      type: 'CLUB',
      name,
      shortName: name,
      slug: `club-${id.slice(-12)}`,
      countryCode: 'RU',
      status: 'ACTIVE',
    },
  });
  return id;
}

/** Действующий тренер клуба — получатель дайджеста (organizationRecipients требует право подавать заявки). */
async function coach(organizationId: string, email: string): Promise<string> {
  const userId = uuidv7();
  await db.user.create({
    data: { id: userId, email, displayName: email, status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const role = await db.role.findUniqueOrThrow({ where: { code: 'COACH' } });
  await db.organizationMembership.create({
    data: {
      id: uuidv7(),
      organizationId,
      userId,
      roleId: role.id,
      status: 'ACTIVE',
      validFrom: new Date('2020-01-01'),
    },
  });
  return userId;
}

async function competition(name: string, organizerOrganizationId: string): Promise<string> {
  const id = uuidv7();
  await db.competition.create({
    data: {
      id,
      slug: `c-${id.slice(-12)}`,
      name,
      organizerOrganizationId,
      timezone: 'Europe/Moscow',
      startDate: new Date('2026-11-14T00:00:00Z'),
      endDate: new Date('2026-11-14T00:00:00Z'),
      registrationStartsAt: new Date('2026-10-01T00:00:00Z'),
      registrationEndsAt: new Date('2026-11-10T00:00:00Z'),
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
    },
  });
  return id;
}

async function category(competitionId: string): Promise<string> {
  const id = uuidv7();
  await db.competitionCategory.create({
    data: {
      id,
      competitionId,
      code: `CAT-${id.slice(-8).toUpperCase()}`,
      nameRu: 'До 60 кг, юноши',
      nameEn: 'Up to 60 kg, boys',
      gender: 'MALE',
      agePolicy: 'EXACT_ON_DATE',
      weightKind: 'UP_TO',
      weightUpperGrams: 60000,
    },
  });
  return id;
}

// athlete_profile_public_id_ck: ровно 12 символов из алфавита без 0/O/I/l (не как у uuid). Достаточно для теста —
// отдельный счётчик, без претензии на настоящий публичный формат.
const PUBLIC_ID_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz';
let publicIdCounter = 0;
function nextPublicId(): string {
  publicIdCounter += 1;
  let n = publicIdCounter;
  let s = '';
  while (s.length < 12) {
    s += PUBLIC_ID_ALPHABET[n % PUBLIC_ID_ALPHABET.length];
    n = Math.floor(n / PUBLIC_ID_ALPHABET.length) + 1;
  }
  return s;
}

/**
 * Спортсмен клуба, записанный в категорию турнира (заявка → запись) и поставленный участником схватки —
 * ровно то, через что affectedOrganizations находит клуб по matchId (matchParticipant → entry → application).
 */
async function entryOnMatch(
  competitionId: string,
  categoryId: string,
  organizationId: string,
  publicName: string,
): Promise<string> {
  const person = uuidv7();
  await db.person.create({
    data: {
      id: person,
      lastName: publicName,
      firstName: 'Спортсмен',
      birthDate: new Date('2012-01-01T00:00:00Z'),
      gender: 'MALE',
    },
  });
  const athleteId = uuidv7();
  await db.athleteProfile.create({ data: { id: athleteId, personId: person, publicId: nextPublicId() } });
  const applicationId = uuidv7();
  await db.application.create({
    data: {
      id: applicationId,
      competitionId,
      organizationId,
      status: 'APPROVED',
      submittedAt: new Date(),
    },
  });
  const entryId = uuidv7();
  await db.entry.create({
    data: {
      id: entryId,
      competitionId,
      applicationId,
      athleteId,
      categoryId,
      declaredCategoryId: categoryId,
      status: 'APPROVED',
      snapLastName: publicName,
      snapFirstName: 'Спортсмен',
      snapBirthDate: new Date('2012-01-01T00:00:00Z'),
      snapGender: 'MALE',
      publicName,
    },
  });
  return entryId;
}

async function matchOf(competitionId: string, categoryId: string, entryId: string): Promise<string> {
  const matchId = uuidv7();
  await db.match.create({
    data: {
      id: matchId,
      competitionId,
      categoryId,
      publicId: nextPublicId(),
      roundLabel: 'R1',
    },
  });
  await db.matchParticipant.create({
    data: { id: uuidv7(), competitionId, matchId, side: 'RED', entryId },
  });
  return matchId;
}

async function scheduleChangedEvent(competitionId: string, matchIds: string[]): Promise<string> {
  const id = uuidv7();
  await db.outboxEvent.create({
    data: {
      id,
      type: 'schedule.changed',
      aggregateType: 'Schedule',
      aggregateId: competitionId,
      payload: { competitionId, matchIds },
    },
  });
  return id;
}

const job = <T>(data: T, attemptsMade = 0) =>
  ({ data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<T>;

describe('schedule change digest', () => {
  it('merges manual-edit batches of the same club into one delayed digest, and skips an untouched club', async () => {
    const clubA = await club('СК «Витязь»');
    const clubB = await club('СК «Самбо-77»');
    const coachA = await coach(clubA, 'coach-a@club.test');
    await coach(clubB, 'coach-b@club.test'); // получатель клуба B — проверяем, что его тоже не забыли, отдельным событием ниже
    const competitionId = await competition('Открытый ковёр', clubA);
    const categoryId = await category(competitionId);
    const m1 = await matchOf(
      competitionId,
      categoryId,
      await entryOnMatch(competitionId, categoryId, clubA, 'Иванов'),
    );
    const m2 = await matchOf(
      competitionId,
      categoryId,
      await entryOnMatch(competitionId, categoryId, clubA, 'Петров'),
    );
    const m3 = await matchOf(
      competitionId,
      categoryId,
      await entryOnMatch(competitionId, categoryId, clubB, 'Сидоров'),
    );

    const queue = new FakeQueue();
    const consumer = new NotificationConsumer(
      db,
      new FakeMailer(),
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
    );

    // Два пакета ручной правки турнира за несколько минут: первый трогает только клуб A, второй — клуб A (другую
    // схватку) и клуб B. Правильно: один дайджест на клуб A со слитыми matchIds, один дайджест на клуб B.
    const e1 = await scheduleChangedEvent(competitionId, [m1]);
    await consumer.handle(job<OutboxJob>({ eventId: e1, type: 'schedule.changed', traceId: null }));
    const e2 = await scheduleChangedEvent(competitionId, [m2, m3]);
    await consumer.handle(job<OutboxJob>({ eventId: e2, type: 'schedule.changed', traceId: null }));

    // Один дайджест на клуб, несмотря на два пакета правки: у клуба A они слились в одну задачу (matchIds
    // объединились), у клуба B задача появилась только со второго пакета, которым он впервые затронут.
    const digests = queue.jobs.filter(
      (j): j is ScheduleDigestJob => 'kind' in j && j.kind === 'schedule-digest',
    );
    expect(digests).toHaveLength(2);
    const byOrg = new Map(digests.map((d) => [d.organizationId, d]));
    expect(byOrg.get(clubA)?.matchIds).toEqual([m1, m2, m3]);
    expect(byOrg.get(clubB)?.matchIds).toEqual([m2, m3]);
    expect(byOrg.get(clubA)?.digestId).not.toBe(byOrg.get(clubB)?.digestId);

    // Дайджест клуба A сработал (10 минут прошли, план §4) — одно уведомление его тренеру, не клубу B.
    const digestA = byOrg.get(clubA) as ScheduleDigestJob;
    const mailer = new FakeMailer();
    const consumer2 = new NotificationConsumer(
      db,
      mailer,
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
    );
    await consumer2.handle(job(digestA));
    const notifications = await db.notification.findMany({ where: { type: 'schedule.changed' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      userId: coachA,
      params: { competitionId },
      sourceEventId: digestA.digestId,
    });

    const [deliveryJob] = queue.jobs.filter((j): j is DeliveryJob => 'deliveryId' in j);
    expect(deliveryJob).toBeDefined();
    await consumer2.handle(job(deliveryJob as DeliveryJob));
    const mail = mailer.sent[0];
    expect(mail?.to).toBe('coach-a@club.test');
    expect(mail?.email.subject).toBe('Расписание турнира изменилось — SAMBO Digital');
    expect(mail?.email.text).toContain('«Открытый ковёр»');
    expect(mail?.email.text).toContain(`https://sambo.test/ru/competitions/${competitionId}`);
  });
});
