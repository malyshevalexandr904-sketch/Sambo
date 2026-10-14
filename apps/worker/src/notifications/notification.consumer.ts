// Уведомления (DATABASE.md, 3.8): по событию outbox — уведомления получателям с доставкой в ленту (сразу), на email и
// push (по настройкам пользователя, отдельными задачами с повторами). Идемпотентно: ProcessedEvent и уникальность
// (источник, получатель). Phase 8b — уведомления дня соревнований: «началась схватка» по событию, «изменилось время»
// по правке расписания, «скоро выступает» — проверкой очереди ковров по событиям и раз в минуту.
import { EVENT_SCHEMAS, type Locale, notificationLink, type NotificationType } from '@sde/contracts';
import { notificationSource, type PrismaClient, uuidv7 } from '@sde/db';
import type { Env, LivePublisher, Logger } from '@sde/server-kit';
import type { Job, Queue } from 'bullmq';
import type { Mailer } from '../email/mailer';
import { TemplateParamsError } from '../email/templates';
import type { OutboxJob } from '../outbox/dispatcher';
import { PushDelivery } from '../push/push-delivery';
import type { PushTransport } from '../push/web-push';
import {
  planMatchNotifications,
  soonCompetitions,
  soonDueFor,
  soonSourceKey,
  timeChangedSourceKey,
} from './match-day';
import {
  affectedOrganizations,
  applicationRecipients,
  organizationRecipients,
  type PlannedNotification,
  type RecipientsReader,
  resultsRecipients,
} from './recipients';
import { renderNotificationEmail } from './templates';
import { NotificationWriter, type PlannedFromSource } from './writer';

export type { PlannedNotification } from './recipients';

export const NOTIFICATIONS_CONSUMER = 'notifications';

export interface DeliveryJob {
  deliveryId: string;
}

/**
 * Отложенный дайджест изменений расписания одного клуба (ARCHITECTURE.md, 14.6; план Phase 6, §4): пакеты
 * ручной правки за 10 минут копятся в одной задаче (см. `scheduleDigest`) и уходят одним уведомлением.
 * `digestId` — стабильный UUID дайджеста, использованный как sourceEventId всех его уведомлений.
 */
export interface ScheduleDigestJob {
  kind: 'schedule-digest';
  digestId: string;
  competitionId: string;
  organizationId: string;
  matchIds: string[];
}

/** «Скоро выступает» (Phase 8b): проверка очереди ковров турнира и поминутный обход идущих турниров. */
export interface SoonCheckJob {
  kind: 'soon-check';
  competitionId: string;
}
export interface SoonScanJob {
  kind: 'soon-scan';
}

export type NotificationJob = OutboxJob | DeliveryJob | ScheduleDigestJob | SoonCheckJob | SoonScanJob;

const kindOf = (j: NotificationJob): string | null => ('kind' in j ? j.kind : null);
const isDigestJob = (j: NotificationJob): j is ScheduleDigestJob => kindOf(j) === 'schedule-digest';

/** Окно объединения изменений расписания в одно уведомление клубу (план Phase 6, §4). */
export const SCHEDULE_DIGEST_DELAY_MS = 10 * 60 * 1000;
/** Проверка «скоро» после события турнира: события одной команды складываются в одну проверку. */
export const SOON_CHECK_DELAY_MS = 2_000;
/** Поминутный обход идущих турниров (перенос, отмена, начало сессии — без событий outbox). */
export const SOON_SCAN_EVERY_MS = 60_000;

/** События, после которых очередь ковров могла сдвинуться. */
const SOON_TRIGGERS = new Set(['match.started', 'match.result_confirmed', 'schedule.changed']);
/** «Изменилось время» — только о схватках, которые ещё не начались. */
const WAITING = new Set(['SCHEDULED', 'READY', 'POSTPONED']);

/** Задержки повтора задач уведомлений в тестах можно уменьшить. */
export interface NotificationConsumerOptions {
  /** Транспорт Web Push (ключи VAPID есть); null — push выключен. */
  push?: PushTransport | null;
  soonCheckDelayMs?: number;
}

/**
 * Какие уведомления создаёт событие: «заявка возвращена», «решение по заявке», «участие отклонено», «документ
 * отклонён», «опубликованы результаты».
 */
export async function planNotifications(
  db: RecipientsReader,
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
    case 'category.results_published': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      return resultsRecipients(db, p.competitionId, p.categoryId);
    }
    default:
      return [];
  }
}

export class NotificationConsumer {
  private readonly writer: NotificationWriter;
  private readonly push: PushDelivery;
  private readonly soonCheckDelayMs: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly mailer: Mailer,
    private readonly queue: Queue<NotificationJob>,
    private readonly logger: Logger,
    private readonly env: Env,
    live: LivePublisher | null = null,
    opts: NotificationConsumerOptions = {},
  ) {
    this.writer = new NotificationWriter(db, queue, logger, live, !!opts.push);
    this.push = new PushDelivery(db, opts.push ?? null, logger);
    this.soonCheckDelayMs = opts.soonCheckDelayMs ?? SOON_CHECK_DELAY_MS;
  }

  async handle(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;
    if ('deliveryId' in data) {
      if (job.name === 'deliver-push') return this.push.deliver(job as Job<DeliveryJob>);
      return this.deliver(job as Job<DeliveryJob>);
    }
    if (isDigestJob(data)) return this.sendDigest(data);
    if ('kind' in data && data.kind === 'soon-check') return this.soonCheck(data.competitionId);
    if ('kind' in data && data.kind === 'soon-scan') return this.soonScan();
    return this.create(data);
  }

  private async create({ eventId, traceId }: OutboxJob): Promise<void> {
    const done = await this.db.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: NOTIFICATIONS_CONSUMER, eventId } },
    });
    const event = await this.db.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return;
    const sources = done ? [] : await this.plan(event.type, eventId, event.payload);
    if (!done) {
      const created = await this.writer.storeMany(sources, (tx) =>
        tx.processedEvent.create({ data: { consumer: NOTIFICATIONS_CONSUMER, eventId } }),
      );
      this.logger.info({ eventId, traceId, notifications: created.length }, 'Notifications created');
      await this.writer.announce(created);
    }
    await this.writer.enqueueDeliveries([eventId, ...this.sourceIdsOf(event.type, eventId, event.payload)]);
    // Очередь ковров могла сдвинуться: «скоро выступает» — проверка через пару секунд (и при повторе задачи).
    if (event.competitionId && SOON_TRIGGERS.has(event.type))
      await this.scheduleSoonCheck(event.competitionId);
  }

  /** Источники уведомлений события, кроме самого события (правка расписания — по схватке). */
  private sourceIdsOf(type: string, eventId: string, payload: unknown): string[] {
    if (type !== 'schedule.changed') return [];
    const p = EVENT_SCHEMAS['schedule.changed'].parse(payload);
    return p.matchIds.map((m) => timeChangedSourceKey(eventId, m));
  }

  /** Уведомления события с их источниками. */
  private async plan(type: string, eventId: string, payload: unknown): Promise<PlannedFromSource[]> {
    if (type === 'match.started') {
      const p = EVENT_SCHEMAS['match.started'].parse(payload);
      const plans = await planMatchNotifications(this.db, 'match.started', p.matchId);
      return plans.map((plan) => ({ sourceId: eventId, plan }));
    }
    if (type === 'schedule.changed') {
      // Клубу — сводка за 10 минут (Phase 6); семье и подписавшимся — по каждой перенесённой схватке сразу.
      await this.scheduleDigest(payload);
      const p = EVENT_SCHEMAS['schedule.changed'].parse(payload);
      const out: PlannedFromSource[] = [];
      for (const matchId of p.matchIds) {
        const match = await this.db.match.findUnique({ where: { id: matchId }, select: { status: true } });
        if (!match || !WAITING.has(match.status)) continue;
        const sourceId = timeChangedSourceKey(eventId, matchId);
        for (const plan of await planMatchNotifications(this.db, 'match.time_changed', matchId))
          out.push({ sourceId, plan });
      }
      return out;
    }
    const plans = await planNotifications(this.db, type, payload);
    return plans.map((plan) => ({ sourceId: eventId, plan }));
  }

  /**
   * Копит событие в отложенной задаче дайджеста клуба (jobId — ключ (турнир, клуб), см. ScheduleDigestJob):
   * задача ещё не всплыла — событие сливается в неё (matchIds объединяются), иначе заводится новая на 10 минут.
   */
  private async scheduleDigest(payload: unknown): Promise<void> {
    const p = EVENT_SCHEMAS['schedule.changed'].parse(payload);
    const organizationIds = await affectedOrganizations(this.db, p.matchIds);
    for (const organizationId of organizationIds) {
      const jobId = `schedule-digest:${p.competitionId}:${organizationId}`;
      const existing = await this.queue.getJob(jobId);
      if (existing && isDigestJob(existing.data) && (await existing.isDelayed())) {
        // Тип задачи сужен явно: Job<NotificationJob>.updateData принимает объединение параметром
        // контравариантно (TS требует пересечение), а isDigestJob сузил только existing.data, не сам Job.
        const digest = existing as Job<ScheduleDigestJob>;
        const matchIds = [...new Set([...digest.data.matchIds, ...p.matchIds])];
        await digest.updateData({ ...digest.data, matchIds });
        continue;
      }
      const data: ScheduleDigestJob = {
        kind: 'schedule-digest',
        digestId: uuidv7(),
        competitionId: p.competitionId,
        organizationId,
        matchIds: [...p.matchIds],
      };
      await this.queue.add('schedule-digest', data, { jobId, delay: SCHEDULE_DIGEST_DELAY_MS });
    }
  }

  /** Дайджест сработал: одно уведомление на каждого действующего получателя клуба. */
  private async sendDigest(data: ScheduleDigestJob): Promise<void> {
    const userIds = await organizationRecipients(this.db, data.organizationId);
    if (userIds.length === 0) return;
    const created = await this.writer.storeMany(
      userIds.map((userId) => ({
        sourceId: data.digestId,
        plan: {
          userId,
          type: 'schedule.changed' as const,
          params: { competitionId: data.competitionId },
          competitionId: data.competitionId,
        },
      })),
    );
    await this.writer.announce(created);
    this.logger.info(
      {
        competitionId: data.competitionId,
        organizationId: data.organizationId,
        matches: data.matchIds.length,
      },
      'Schedule change digest sent',
    );
    await this.writer.enqueueDeliveries([data.digestId]);
  }

  /**
   * Проверка «скоро» по турниру — одна на турнир за раз: задача с тем же jobId, пока она ждёт, не дублируется,
   * а после выполнения удаляется (иначе BullMQ не принял бы следующую с тем же jobId).
   */
  private async scheduleSoonCheck(competitionId: string): Promise<void> {
    const data: SoonCheckJob = { kind: 'soon-check', competitionId };
    await this.queue.add('soon-check', data, {
      jobId: `soon-check-${competitionId}`,
      delay: this.soonCheckDelayMs,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * «Скоро выступает»: схватки, перед которыми на ковре осталось не больше N. Получатель, уже получивший «скоро» по
   * схватке, второго не получает (ключ источника — схватка); подписавшийся позже, пока схватка ещё впереди, — получит.
   */
  async soonCheck(competitionId: string): Promise<void> {
    const due = await soonDueFor(this.db, competitionId, Date.now());
    const sourceIds: string[] = [];
    for (const { matchId, ahead } of due) {
      const sourceId = soonSourceKey(matchId);
      const plans = await planMatchNotifications(this.db, 'match.soon', matchId, { ahead: String(ahead) });
      if (plans.length === 0) continue;
      const known = new Set(
        (
          await this.db.notification.findMany({
            where: { sourceEventId: sourceId, userId: { in: plans.map((p) => p.userId) } },
            select: { userId: true },
          })
        ).map((n) => n.userId),
      );
      const fresh = plans.filter((p) => !known.has(p.userId));
      if (fresh.length === 0) continue;
      const created = await this.writer.storeMany(fresh.map((plan) => ({ sourceId, plan })));
      await this.writer.announce(created);
      sourceIds.push(sourceId);
    }
    await this.writer.enqueueDeliveries(sourceIds);
    if (sourceIds.length > 0)
      this.logger.info({ competitionId, matches: sourceIds.length }, 'Match soon notifications created');
  }

  private async soonScan(): Promise<void> {
    for (const competitionId of await soonCompetitions(this.db)) await this.soonCheck(competitionId);
  }

  /** Письмо уведомления. Шаблон без данных (запись удалена) — FAILED без повторов; сбой отправки — повтор. */
  private async deliver(job: Job<DeliveryJob>): Promise<void> {
    const { deliveryId } = job.data;
    const d = await this.db.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { user: { select: { email: true, locale: true } } } } },
    });
    if (!d || d.status !== 'PENDING' || d.channel !== 'EMAIL') return;
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
        renderNotificationEmail(type, locale, { ...text, ahead: params.ahead ?? '', url }),
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
