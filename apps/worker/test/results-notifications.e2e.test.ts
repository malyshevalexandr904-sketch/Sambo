// Integration (worker, Phase 8a): «опубликованы результаты» — получатели (клуб, подтверждённые представители,
// сам спортсмен с учётной записью), одно уведомление на получателя, письмо, живой канал `user`.
import { PrismaClient, publicId, uuidv7 } from '@sde/db';
import { createLogger, type Env, type LivePublication, type LivePublisher } from '@sde/server-kit';
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
  async send(to: string, email: RenderedEmail): Promise<{ messageId: string | null }> {
    this.sent.push({ to, email });
    return { messageId: `m-${this.sent.length}` };
  }
}

class FakeQueue {
  jobs: DeliveryJob[] = [];
  private readonly ids = new Set<string>();
  async add(_name: string, data: NotificationJob, opts?: { jobId?: string }): Promise<void> {
    if (opts?.jobId && this.ids.has(opts.jobId)) return;
    if (opts?.jobId) this.ids.add(opts.jobId);
    this.jobs.push(data as DeliveryJob);
  }
}

class FakeLive {
  published: LivePublication<unknown>[] = [];
  async publish<P>(p: LivePublication<P>): Promise<number> {
    this.published.push(p);
    return this.published.length;
  }
}

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE sync_log, placement, category_result, draw, entry, application, guardian,
    athlete_profile, competition_category, competition_write_lease, competition, outbox_event, processed_event,
    notification, notification_preference, organization_membership, organization, "user", person CASCADE`;
});

async function person(lastName: string, birthDate = '2013-04-01'): Promise<string> {
  const id = uuidv7();
  await db.person.create({
    data: { id, lastName, firstName: 'Тест', birthDate: new Date(birthDate), gender: 'MALE' },
  });
  return id;
}

async function user(email: string, personId: string | null = null): Promise<string> {
  const id = uuidv7();
  await db.user.create({
    data: {
      id,
      email,
      displayName: email,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      locale: 'ru',
      personId,
    },
  });
  return id;
}

interface World {
  competitionId: string;
  categoryId: string;
  coach: string;
  manager: string;
  guardianUser: string;
  formerGuardianUser: string;
  selfUser: string;
  athleteA: string;
  athleteB: string;
}

/** Клуб с заявкой на двух спортсменов; у A — подтверждённый представитель и бывший; B — со своей учётной записью. */
async function world(): Promise<World> {
  const coach = await user('coach@club.test');
  const manager = await user('manager@club.test');
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
  const role = await db.role.findUniqueOrThrow({ where: { code: 'COACH' } });
  for (const userId of [coach, manager])
    await db.organizationMembership.create({
      data: { id: uuidv7(), organizationId: orgId, userId, roleId: role.id, status: 'ACTIVE' },
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
  const categoryId = uuidv7();
  await db.competitionCategory.create({
    data: {
      id: categoryId,
      competitionId,
      code: 'M-46',
      nameRu: 'Юноши до 46 кг',
      nameEn: 'Boys up to 46 kg',
      gender: 'MALE',
      agePolicy: 'BY_BIRTH_YEAR',
      weightKind: 'UP_TO',
      weightUpperGrams: 46_000,
      status: 'RESULTS_PUBLISHED',
    },
  });
  const applicationId = uuidv7();
  await db.application.create({
    data: {
      id: applicationId,
      competitionId,
      organizationId: orgId,
      status: 'APPROVED',
      submittedAt: new Date(),
      submittedByUserId: coach,
      createdById: manager,
    },
  });
  const athletes: string[] = [];
  const entries: string[] = [];
  for (const lastName of ['Иванов', 'Петров']) {
    const personId = await person(lastName);
    const athleteId = uuidv7();
    await db.athleteProfile.create({ data: { id: athleteId, personId, publicId: publicId() } });
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
        snapLastName: lastName,
        snapFirstName: 'Тест',
        snapBirthDate: new Date('2013-04-01'),
        snapGender: 'MALE',
        publicName: `${lastName} Т.`,
      },
    });
    athletes.push(athleteId);
    entries.push(entryId);
  }
  const [athleteA, athleteB] = athletes as [string, string];
  const guardianPerson = await person('Иванова', '1985-01-01');
  const guardianUser = await user('mother@family.test', guardianPerson);
  await db.guardian.create({
    data: {
      id: uuidv7(),
      athleteId: athleteA,
      guardianPersonId: guardianPerson,
      relation: 'MOTHER',
      verifiedAt: new Date(),
      verificationBasis: 'DOCUMENT_SHOWN',
    },
  });
  const formerPerson = await person('Иванов', '1984-01-01');
  const formerGuardianUser = await user('father@family.test', formerPerson);
  await db.guardian.create({
    data: {
      id: uuidv7(),
      athleteId: athleteA,
      guardianPersonId: formerPerson,
      relation: 'FATHER',
      verifiedAt: new Date(),
      verificationBasis: 'DOCUMENT_SHOWN',
      endedAt: new Date(),
      endReason: 'Решение суда',
    },
  });
  const selfPerson = (await db.athleteProfile.findUniqueOrThrow({ where: { id: athleteB } })).personId;
  const selfUser = await user('petrov@athlete.test', selfPerson);
  const drawId = uuidv7();
  await db.draw.create({
    data: {
      id: drawId,
      competitionId,
      categoryId,
      number: 1,
      status: 'PUBLISHED',
      format: 'SINGLE_ELIMINATION',
      algorithmVersion: 'draw-v1',
      randomSeed: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
      inputHash: 'a'.repeat(64),
      input: {},
      separationReport: {},
      publishedAt: new Date(),
    },
  });
  const resultId = uuidv7();
  await db.categoryResult.create({
    data: {
      id: resultId,
      competitionId,
      categoryId,
      drawId,
      status: 'PUBLISHED',
      computedAt: new Date(),
      publishedAt: new Date(),
      publishedById: manager,
    },
  });
  for (const [i, entryId] of entries.entries())
    await db.placement.create({
      data: {
        id: uuidv7(),
        competitionId,
        categoryResultId: resultId,
        entryId,
        place: i + 1,
        medal: i === 0 ? 'GOLD' : 'SILVER',
        wins: 1 - i,
        losses: i,
      },
    });
  return {
    competitionId,
    categoryId,
    coach,
    manager,
    guardianUser,
    formerGuardianUser,
    selfUser,
    athleteA,
    athleteB,
  };
}

const job = <T>(data: T) => ({ data, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job<T>;

describe('results published', () => {
  it('notifies the club once, the verified guardian and the athlete with an account; live channel and email', async () => {
    const w = await world();
    const mailer = new FakeMailer();
    const queue = new FakeQueue();
    const live = new FakeLive();
    const consumer = new NotificationConsumer(
      db,
      mailer,
      queue as unknown as Queue<NotificationJob>,
      logger,
      env,
      live as unknown as LivePublisher,
    );
    const eventId = uuidv7();
    await db.outboxEvent.create({
      data: {
        id: eventId,
        type: 'category.results_published',
        aggregateType: 'CompetitionCategory',
        aggregateId: w.categoryId,
        competitionId: w.competitionId,
        payload: { categoryId: w.categoryId, competitionId: w.competitionId },
      },
    });
    const outbox = { eventId, type: 'category.results_published', traceId: null } satisfies OutboxJob;
    await consumer.handle(job(outbox));
    await consumer.handle(job(outbox));

    const rows = await db.notification.findMany({ where: { type: 'results.published' } });
    const byUser = new Map(rows.map((r) => [r.userId, r.params as Record<string, string>]));
    expect([...byUser.keys()].sort()).toEqual([w.coach, w.manager, w.guardianUser, w.selfUser].sort());
    const base = { competitionId: w.competitionId, categoryId: w.categoryId };
    // Клуб — два спортсмена: ссылка на турнир; представитель и сам спортсмен — на карточку своего спортсмена.
    expect(byUser.get(w.coach)).toEqual(base);
    expect(byUser.get(w.guardianUser)).toMatchObject({ ...base, athleteId: w.athleteA });
    expect(byUser.get(w.selfUser)).toMatchObject({ ...base, athleteId: w.athleteB });
    expect(byUser.has(w.formerGuardianUser)).toBe(false);

    // Повтор задачи ничего не дублирует — ни уведомлений, ни сообщений в живой канал.
    expect(live.published).toHaveLength(4);
    expect(live.published.every((p) => p.channel === 'user' && p.type === 'notification')).toBe(true);
    expect(live.published.map((p) => p.room).sort()).toEqual(
      [w.coach, w.manager, w.guardianUser, w.selfUser].map((id) => `user:${id}`).sort(),
    );

    expect(queue.jobs).toHaveLength(4);
    for (const d of queue.jobs) await consumer.handle(job(d));
    const toCoach = mailer.sent.find((m) => m.to === 'coach@club.test');
    expect(toCoach?.email.subject).toBe('Опубликованы результаты — SAMBO Digital');
    expect(toCoach?.email.text).toContain(
      'Опубликованы результаты категории «Юноши до 46 кг» турнира «Первенство города»',
    );
    expect(toCoach?.email.text).toContain(`https://sambo.test/ru/competitions/${w.competitionId}`);
    // В письмах нет имён детей и мест (SECURITY.md, 3.7).
    expect(mailer.sent.map((m) => m.email.text).join('\n')).not.toMatch(/Иванов|Петров|GOLD|золото/);
    const toMother = mailer.sent.find((m) => m.to === 'mother@family.test');
    expect(toMother?.email.text).toContain(`https://sambo.test/ru/athletes/${w.athleteA}`);
  });
});
