// Уведомления (DATABASE.md, 3.8): по событию outbox — уведомления получателям с доставкой в ленту (сразу) и
// на email (по настройке пользователя, отдельной задачей с повторами). Идемпотентно: ProcessedEvent и
// уникальность (событие, получатель).
import {
  EVENT_SCHEMAS,
  type Locale,
  notificationLink,
  type NotificationType,
  ROLE_CODES,
  ROLE_PERMISSIONS,
} from '@sde/contracts';
import { notificationSource, type Prisma, type PrismaClient, uuidv7 } from '@sde/db';
import type { Env, Logger } from '@sde/server-kit';
import type { Job, Queue } from 'bullmq';
import type { Mailer } from '../email/mailer';
import { TemplateParamsError } from '../email/templates';
import type { OutboxJob } from '../outbox/dispatcher';
import { renderNotificationEmail } from './templates';

export const NOTIFICATIONS_CONSUMER = 'notifications';

export interface DeliveryJob {
  deliveryId: string;
}

export type NotificationJob = OutboxJob | DeliveryJob;

export interface PlannedNotification {
  userId: string;
  type: NotificationType;
  params: Record<string, string>;
  competitionId: string | null;
}

type Reader = Pick<PrismaClient, 'application' | 'entry' | 'document' | 'user' | 'organizationMembership'>;

/** Организационные роли с правом подавать заявки: получатели уведомлений о заявке — только они. */
const APPLICANT_ROLES = ROLE_CODES.filter(
  (r) => ROLE_PERMISSIONS[r]['registration.create'] !== undefined && r !== 'SUPER_ADMIN',
);

/**
 * Получатели по заявке: подавший и создавший её — если они по-прежнему действующие пользователи с правом подавать
 * заявки в организации заявки (ушедшему из клуба сведения о заявке не отправляются).
 */
async function applicationRecipients(db: Reader, applicationId: string) {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { competitionId: true, organizationId: true, submittedByUserId: true, createdById: true },
  });
  if (!app) return null;
  const ids = [...new Set([app.submittedByUserId, app.createdById].filter((x): x is string => !!x))];
  const today = new Date(new Date().toISOString().slice(0, 10));
  const members = await db.organizationMembership.findMany({
    where: {
      organizationId: app.organizationId,
      userId: { in: ids },
      status: 'ACTIVE',
      role: { code: { in: APPLICANT_ROLES } },
      OR: [{ validTo: null }, { validTo: { gte: today } }],
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((m) => m.userId).filter((x): x is string => !!x))];
  return { competitionId: app.competitionId, userIds };
}

/** Какие уведомления создаёт событие: «заявка возвращена», «решение по заявке», «участие отклонено», «документ отклонён». */
export async function planNotifications(
  db: Reader,
  type: string,
  payload: unknown,
): Promise<PlannedNotification[]> {
  const forApplication = async (
    applicationId: string,
    t: NotificationType,
    params: Record<string, string>,
  ) => {
    const r = await applicationRecipients(db, applicationId);
    return r ? r.userIds.map((userId) => ({ userId, type: t, params, competitionId: r.competitionId })) : [];
  };
  switch (type) {
    case 'registration.application_returned': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      return forApplication(p.applicationId, 'application.returned', { applicationId: p.applicationId });
    }
    case 'registration.application_decided': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      return forApplication(p.applicationId, 'application.decided', {
        applicationId: p.applicationId,
        status: p.status,
      });
    }
    case 'registration.entry_decided': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      if (p.decision !== 'REJECTED') return [];
      const entry = await db.entry.findUnique({ where: { id: p.entryId }, select: { applicationId: true } });
      if (!entry) return [];
      return forApplication(entry.applicationId, 'entry.rejected', {
        entryId: p.entryId,
        applicationId: entry.applicationId,
      });
    }
    case 'document.rejected': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      const doc = await db.document.findUnique({
        where: { id: p.documentId },
        select: { uploadedById: true, competitionId: true, uploadedBy: { select: { status: true } } },
      });
      if (!doc?.uploadedById || doc.uploadedBy?.status !== 'ACTIVE') return [];
      return [
        {
          userId: doc.uploadedById,
          type: 'document.rejected',
          params: { documentId: p.documentId },
          competitionId: doc.competitionId,
        },
      ];
    }
    default:
      return [];
  }
}

export class NotificationConsumer {
  constructor(
    private readonly db: PrismaClient,
    private readonly mailer: Mailer,
    private readonly queue: Queue<NotificationJob>,
    private readonly logger: Logger,
    private readonly env: Env,
  ) {}

  async handle(job: Job<NotificationJob>): Promise<void> {
    if ('deliveryId' in job.data) return this.deliver(job as Job<DeliveryJob>);
    return this.create(job.data);
  }

  private async create({ eventId, traceId }: OutboxJob): Promise<void> {
    const done = await this.db.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: NOTIFICATIONS_CONSUMER, eventId } },
    });
    if (!done) {
      const event = await this.db.outboxEvent.findUnique({ where: { id: eventId } });
      if (!event) return;
      const plan = await planNotifications(this.db, event.type, event.payload);
      await this.db.$transaction(async (tx) => {
        for (const p of plan) await this.store(tx, eventId, p);
        await tx.processedEvent.create({ data: { consumer: NOTIFICATIONS_CONSUMER, eventId } });
      });
      this.logger.info({ eventId, traceId, notifications: plan.length }, 'Notifications created');
    }
    await this.enqueueEmails(eventId);
  }

  /**
   * Письма ставятся в очередь после фиксации уведомлений — и при повторе задачи тоже: если постановка упала или
   * worker остановился между фиксацией и постановкой, повтор найдёт ожидающие доставки (jobId не даёт дублей).
   */
  private async enqueueEmails(eventId: string): Promise<void> {
    const pending = await this.db.notificationDelivery.findMany({
      where: { channel: 'EMAIL', status: 'PENDING', notification: { sourceEventId: eventId } },
      select: { id: true },
    });
    for (const d of pending)
      await this.queue.add('deliver-email', { deliveryId: d.id }, { jobId: `email-${d.id}` });
  }

  /** Уведомление с доставками: лента — сразу, email — по настройке и подтверждённому адресу. */
  private async store(tx: Prisma.TransactionClient, eventId: string, p: PlannedNotification): Promise<void> {
    const exists = await tx.notification.findUnique({
      where: { sourceEventId_userId: { sourceEventId: eventId, userId: p.userId } },
      select: { id: true },
    });
    if (exists) return;
    const user = await tx.user.findUnique({
      where: { id: p.userId },
      select: { email: true, emailVerifiedAt: true },
    });
    const pref = await tx.notificationPreference.findUnique({
      where: { userId_type_channel: { userId: p.userId, type: p.type, channel: 'EMAIL' } },
    });
    const email = (pref?.enabled ?? true) && !!user?.email && !!user.emailVerifiedAt;
    await tx.notification.create({
      data: {
        id: uuidv7(),
        userId: p.userId,
        type: p.type,
        params: p.params,
        competitionId: p.competitionId,
        sourceEventId: eventId,
        deliveries: {
          create: [
            { id: uuidv7(), channel: 'IN_APP', status: 'SENT', attempts: 1, sentAt: new Date() },
            { id: uuidv7(), channel: 'EMAIL', status: email ? 'PENDING' : 'SKIPPED' },
          ],
        },
      },
    });
  }

  /** Письмо уведомления. Шаблон без данных (запись удалена) — FAILED без повторов; сбой отправки — повтор. */
  private async deliver(job: Job<DeliveryJob>): Promise<void> {
    const { deliveryId } = job.data;
    const d = await this.db.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { user: { select: { email: true, locale: true } } } } },
    });
    if (!d || d.status !== 'PENDING') return;
    const n = d.notification;
    const locale: Locale = n.user.locale === 'en' ? 'en' : 'ru';
    const type = n.type as NotificationType;
    const params = n.params as Record<string, string>;
    try {
      if (!n.user.email) throw new TemplateParamsError('no email');
      const { organizationId: _org, ...source } = await notificationSource(this.db, type, params, locale);
      const link = notificationLink(type, params) ?? '/';
      const url = `${this.env.APP_URL.replace(/\/$/, '')}/${locale}${link}`;
      const text = Object.fromEntries(
        Object.entries(source).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
      const result = await this.mailer.send(
        n.user.email,
        renderNotificationEmail(type, locale, { ...text, url }),
      );
      await this.db.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts: { increment: 1 },
          providerMessageId: result.messageId,
        },
      });
    } catch (e) {
      const permanent = e instanceof TemplateParamsError;
      const final = permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.db.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: final ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          lastErrorCode: permanent ? 'TEMPLATE_DATA_MISSING' : 'SEND_FAILED',
        },
      });
      this.logger.warn({ deliveryId, final, err: e }, 'Notification email failed');
      if (!final) throw e;
    }
  }
}
