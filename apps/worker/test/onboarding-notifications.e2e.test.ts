// Integration (worker): уведомления о заявках на регистрацию (Phase 9a) — заявителю, проверяющим платформы или
// организации, тренеру с правом рассматривать заявки; email — только если заявитель выбрал этот способ связи.
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

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE onboarding_status_change, onboarding_document, onboarding_request, outbox_event,
    processed_event, notification, notification_preference, organization_membership, platform_role_assignment,
    coach_membership, coach_profile, organization, "user", person CASCADE`;
});

async function user(email: string, opts: { totp?: boolean } = {}): Promise<string> {
  const id = uuidv7();
  await db.user.create({
    data: {
      id,
      email,
      displayName: email,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      totpEnabledAt: opts.totp ? new Date() : null,
    },
  });
  return id;
}

async function role(userId: string, code: string, organizationId?: string): Promise<void> {
  const r = await db.role.findUniqueOrThrow({ where: { code } });
  if (organizationId) {
    await db.organizationMembership.create({
      data: { id: uuidv7(), organizationId, userId, roleId: r.id, status: 'ACTIVE' },
    });
  } else {
    await db.platformRoleAssignment.create({ data: { id: uuidv7(), userId, roleId: r.id } });
  }
}

async function club(): Promise<string> {
  const id = uuidv7();
  await db.organization.create({
    data: {
      id,
      type: 'CLUB',
      name: 'СК «Буревестник»',
      shortName: 'Буревестник',
      slug: `club-${id.slice(-12)}`,
      countryCode: 'RU',
      status: 'ACTIVE',
    },
  });
  return id;
}

async function request(
  userId: string,
  data: {
    role: 'ATHLETE' | 'REFEREE';
    status: string;
    organizationId?: string;
    coachId?: string;
    channels: string[];
  },
): Promise<string> {
  const id = uuidv7();
  await db.onboardingRequest.create({
    data: {
      id,
      userId,
      role: data.role,
      status: data.status as 'PENDING_REVIEW',
      inOrganization: !!data.organizationId,
      organizationId: data.organizationId ?? null,
      coachId: data.coachId ?? null,
      contactChannels: data.channels,
      submittedAt: new Date(),
      consentGivenAt: new Date(),
    },
  });
  return id;
}

async function event(type: string, payload: Record<string, string>): Promise<string> {
  const id = uuidv7();
  await db.outboxEvent.create({
    data: {
      id,
      type,
      aggregateType: 'OnboardingRequest',
      aggregateId: payload.requestId ?? uuidv7(),
      payload,
    },
  });
  return id;
}

const job = <T>(data: T) => ({ data, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job<T>;

function consumer(mailer: FakeMailer, queue: FakeQueue): NotificationConsumer {
  return new NotificationConsumer(db, mailer, queue as unknown as Queue<NotificationJob>, logger, env);
}

const byUser = async () =>
  Object.fromEntries(
    (await db.notification.findMany({ include: { deliveries: true } })).map((n) => [
      n.userId,
      { type: n.type, email: n.deliveries.find((d) => d.channel === 'EMAIL')?.status },
    ]),
  );

describe('onboarding notifications', () => {
  it('submission to the platform: applicant is told it was sent, platform reviewers with TOTP — that it awaits review', async () => {
    const applicant = await user('referee@test.local');
    const admin = await user('admin@test.local', { totp: true });
    const noTotp = await user('admin2@test.local');
    await role(admin, 'PLATFORM_ADMIN');
    await role(noTotp, 'PLATFORM_ADMIN');
    const requestId = await request(applicant, {
      role: 'REFEREE',
      status: 'PENDING_REVIEW',
      channels: ['EMAIL'],
    });
    const eventId = await event('onboarding.submitted', { requestId, status: 'PENDING_REVIEW' });
    const mailer = new FakeMailer();
    const queue = new FakeQueue();
    const c = consumer(mailer, queue);
    await c.handle(job<OutboxJob>({ eventId, type: 'onboarding.submitted', traceId: null }));

    expect(await byUser()).toEqual({
      [applicant]: { type: 'onboarding.submitted', email: 'PENDING' },
      [admin]: { type: 'onboarding.awaiting_review', email: 'PENDING' },
    });
    for (const j of queue.jobs) await c.handle(job(j));
    const toApplicant = mailer.sent.find((m) => m.to === 'referee@test.local');
    expect(toApplicant?.email.subject).toBe('Заявка на регистрацию отправлена — Цифровое самбо');
    expect(toApplicant?.email.text).toContain('(роль: судья)');
    expect(toApplicant?.email.text).toContain('https://sambo.test/ru/onboarding');
    const toAdmin = mailer.sent.find((m) => m.to === 'admin@test.local');
    expect(toAdmin?.email.text).toContain(`https://sambo.test/ru/onboarding/review/${requestId}`);
  });

  it('submission to a club: the club head and the coach with the review right; no email if the applicant did not choose it', async () => {
    const clubId = await club();
    const head = await user('head@test.local');
    await role(head, 'CLUB_MANAGER', clubId);
    const coachUser = await user('coach@test.local');
    const personId = uuidv7();
    await db.person.create({
      data: {
        id: personId,
        lastName: 'Тренеров',
        firstName: 'Олег',
        birthDate: new Date('1980-01-01'),
        gender: 'MALE',
      },
    });
    await db.user.update({ where: { id: coachUser }, data: { personId } });
    const coachId = uuidv7();
    await db.coachProfile.create({ data: { id: coachId, personId } });
    await db.coachMembership.create({
      data: {
        id: uuidv7(),
        coachId,
        organizationId: clubId,
        validFrom: new Date('2020-01-01'),
        canReviewAthletes: true,
      },
    });
    const applicant = await user('athlete@test.local');
    const requestId = await request(applicant, {
      role: 'ATHLETE',
      status: 'PENDING_ORGANIZATION_APPROVAL',
      organizationId: clubId,
      coachId,
      channels: ['PHONE', 'TELEGRAM'],
    });
    const c = consumer(new FakeMailer(), new FakeQueue());
    const submitted = await event('onboarding.submitted', {
      requestId,
      status: 'PENDING_ORGANIZATION_APPROVAL',
    });
    await c.handle(job<OutboxJob>({ eventId: submitted, type: 'onboarding.submitted', traceId: null }));
    expect(await byUser()).toEqual({
      [applicant]: { type: 'onboarding.forwarded', email: 'SKIPPED' },
      [head]: { type: 'onboarding.awaiting_review', email: 'PENDING' },
      [coachUser]: { type: 'onboarding.awaiting_review', email: 'PENDING' },
    });

    await db.onboardingRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedById: head },
    });
    const decided = await event('onboarding.decided', { requestId, status: 'APPROVED' });
    await c.handle(job<OutboxJob>({ eventId: decided, type: 'onboarding.decided', traceId: null }));
    const latest = await db.notification.findMany({ where: { sourceEventId: decided } });
    expect(latest.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [applicant, 'onboarding.decided'],
        [head, 'onboarding.linked'],
        [coachUser, 'onboarding.linked'],
      ].sort(),
    );
  });
});
