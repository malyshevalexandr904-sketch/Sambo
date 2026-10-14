// Запись уведомлений и постановка доставок (DATABASE.md, 3.8): лента — сразу, письмо и push — отдельными задачами с
// повторами, по настройкам пользователя (значения по умолчанию — contracts: notificationChannelDefault). Повтор того
// же источника тому же получателю ничего не создаёт (unique `(source_event_id, user_id)`, вставка ON CONFLICT DO
// NOTHING — и при одновременной записи).
import { type ConfigurableChannel, notificationChannelDefault, type NotificationType } from '@sde/contracts';
import { type Prisma, type PrismaClient, uuidv7 } from '@sde/db';
import { type LivePublisher, type Logger, liveUserRoom } from '@sde/server-kit';
import type { JobsOptions } from 'bullmq';
import type { PlannedNotification } from './recipients';

export interface StoredNotification {
  id: string;
  userId: string;
  type: NotificationType;
}

export interface DeliveryQueue {
  add(name: string, data: { deliveryId: string }, opts: JobsOptions): Promise<unknown>;
}

/** Уведомление и его источник: событие outbox, дайджест или детерминированный ключ («скоро»). */
export interface PlannedFromSource {
  sourceId: string;
  plan: PlannedNotification;
}

export class NotificationWriter {
  constructor(
    private readonly db: PrismaClient,
    private readonly queue: DeliveryQueue,
    private readonly logger: Logger,
    /** Живой канал `user` (Phase 8a): колокольчик и лента обновляются сразу. Без него — опросом. */
    private readonly live: LivePublisher | null = null,
    /** Push настроен (ключи VAPID есть): иначе доставка push сразу SKIPPED. */
    private readonly pushEnabled = false,
  ) {}

  private async channelOn(
    tx: Prisma.TransactionClient,
    userId: string,
    type: NotificationType,
    channel: ConfigurableChannel,
  ): Promise<boolean> {
    const pref = await tx.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel } },
    });
    return pref?.enabled ?? notificationChannelDefault(type, channel);
  }

  /** Уведомление с доставками: лента — сразу, письмо — на подтверждённый адрес, push — если есть устройства. */
  async store(
    tx: Prisma.TransactionClient,
    sourceId: string,
    p: PlannedNotification,
  ): Promise<StoredNotification | null> {
    const exists = await tx.notification.findUnique({
      where: { sourceEventId_userId: { sourceEventId: sourceId, userId: p.userId } },
      select: { id: true },
    });
    if (exists) return null;
    const user = await tx.user.findUnique({
      where: { id: p.userId },
      select: { email: true, emailVerifiedAt: true, _count: { select: { pushSubscriptions: true } } },
    });
    const email =
      !!user?.email && !!user.emailVerifiedAt && (await this.channelOn(tx, p.userId, p.type, 'EMAIL'));
    const push =
      this.pushEnabled &&
      (user?._count.pushSubscriptions ?? 0) > 0 &&
      (await this.channelOn(tx, p.userId, p.type, 'PUSH'));
    const id = uuidv7();
    // Вставка без ошибки при гонке: две проверки одновременно (поминутная и по событию) — одна запись, вторая
    // ничего не создаёт и не прерывает транзакцию остальных уведомлений пачки.
    const inserted = await tx.notification.createMany({
      data: [
        {
          id,
          userId: p.userId,
          type: p.type,
          params: p.params,
          competitionId: p.competitionId,
          sourceEventId: sourceId,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return null;
    await tx.notificationDelivery.createMany({
      data: [
        {
          id: uuidv7(),
          notificationId: id,
          channel: 'IN_APP',
          status: 'SENT',
          attempts: 1,
          sentAt: new Date(),
        },
        { id: uuidv7(), notificationId: id, channel: 'EMAIL', status: email ? 'PENDING' : 'SKIPPED' },
        { id: uuidv7(), notificationId: id, channel: 'PUSH', status: push ? 'PENDING' : 'SKIPPED' },
      ],
    });
    return { id, userId: p.userId, type: p.type };
  }

  /** Пачка уведомлений одной транзакцией; `extra` — что ещё записать в ней же (отметка обработанного события). */
  async storeMany(
    items: readonly PlannedFromSource[],
    extra?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<StoredNotification[]> {
    return this.db.$transaction(async (tx) => {
      const out: StoredNotification[] = [];
      for (const { sourceId, plan } of items) {
        const n = await this.store(tx, sourceId, plan);
        if (n) out.push(n);
      }
      if (extra) await extra(tx);
      return out;
    });
  }

  /**
   * Письма и push ставятся в очередь после фиксации уведомлений — и при повторе задачи тоже: если постановка упала
   * или worker остановился между фиксацией и постановкой, повтор найдёт ожидающие доставки (jobId не даёт дублей).
   */
  async enqueueDeliveries(sourceIds: readonly string[]): Promise<void> {
    if (sourceIds.length === 0) return;
    const pending = await this.db.notificationDelivery.findMany({
      where: {
        channel: { in: ['EMAIL', 'PUSH'] },
        status: 'PENDING',
        notification: { sourceEventId: { in: [...new Set(sourceIds)] } },
      },
      select: { id: true, channel: true },
    });
    for (const d of pending) {
      const kind = d.channel === 'PUSH' ? 'push' : 'email';
      await this.queue.add(`deliver-${kind}`, { deliveryId: d.id }, { jobId: `${kind}-${d.id}` });
    }
  }

  /** Новые уведомления — в канал пользователя после фиксации; сбой публикации не мешает доставке. */
  async announce(created: readonly StoredNotification[]): Promise<void> {
    if (!this.live) return;
    for (const n of created)
      await this.live
        .publish({
          channel: 'user',
          room: liveUserRoom(n.userId),
          type: 'notification',
          payload: { notificationId: n.id, type: n.type },
        })
        .catch((err: unknown) => this.logger.warn({ err }, 'Live notification publish failed'));
  }
}
