// Доставка push одного уведомления на все устройства пользователя (Phase 8b): только устройства с живой сессией
// входа (после выхода на устройство ничего не уходит); ответ push-службы 404/410 — подписки больше нет, она
// удаляется. Хотя бы одно устройство приняло — доставлено; иначе при временном сбое — повтор задачи.
import { createHash } from 'node:crypto';
import {
  isMatchDayNotification,
  type Locale,
  notificationLink,
  type NotificationType,
  type PushMessage,
} from '@sde/contracts';
import { notificationSource, type PrismaClient } from '@sde/db';
import type { Logger } from '@sde/server-kit';
import type { Job } from 'bullmq';
import { renderPush } from '../notifications/push-templates';
import { PushEndpointRejected, type PushSendOptions, type PushTransport } from './web-push';

export interface PushDeliveryJob {
  deliveryId: string;
}

/** Ошибка, которую стоит повторить (сеть, 429, 5xx push-службы). */
export class PushTransientError extends Error {}

const HOUR = 3600;

/** Уведомления дня соревнований устаревают за час; остальные push-служба держит сутки, пока устройство офлайн. */
function sendOptions(type: NotificationType, tag: string): PushSendOptions {
  const matchDay = isMatchDayNotification(type);
  return {
    ttlSeconds: matchDay ? HOUR : 24 * HOUR,
    urgency: type === 'match.started' || type === 'match.soon' ? 'high' : 'normal',
    // Тема (≤ 32 символа base64url): новое «скоро» по той же схватке заменяет недоставленное.
    topic: matchDay ? createHash('sha256').update(tag).digest('base64url').slice(0, 32) : undefined,
  };
}

export class PushDelivery {
  constructor(
    private readonly db: PrismaClient,
    private readonly transport: PushTransport | null,
    private readonly logger: Logger,
  ) {}

  /** Подписки пользователя с живой сессией; подписки закончившихся сессий удаляются. */
  private async liveSubscriptions(userId: string) {
    const subs = await this.db.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return [];
    const alive = await this.db.refreshToken.findMany({
      where: {
        familyId: { in: [...new Set(subs.map((s) => s.sessionId))] },
        revokedAt: null,
        replacedById: null,
        expiresAt: { gt: new Date() },
      },
      select: { familyId: true },
    });
    const live = new Set(alive.map((a) => a.familyId));
    const dead = subs.filter((s) => !live.has(s.sessionId)).map((s) => s.id);
    if (dead.length > 0) await this.db.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    return subs.filter((s) => live.has(s.sessionId));
  }

  private async finish(deliveryId: string, status: 'SENT' | 'FAILED' | 'SKIPPED', code: string | null) {
    await this.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        attempts: { increment: 1 },
        sentAt: status === 'SENT' ? new Date() : undefined,
        lastErrorCode: code,
      },
    });
  }

  /** Сообщение push: текст без имён, ссылка в приложении с локалью пользователя, метка схватки или уведомления. */
  private async message(
    notificationId: string,
    type: NotificationType,
    params: Record<string, string>,
    userLocale: string,
  ): Promise<PushMessage> {
    const locale: Locale = userLocale === 'en' ? 'en' : 'ru';
    const { organizationId: _org, ...source } = await notificationSource(this.db, type, params, locale);
    const text = renderPush(type, { ...source, ahead: params.ahead, locale });
    return {
      v: 1,
      title: text.title,
      body: text.body,
      url: `/${locale}${notificationLink(type, params) ?? '/notifications'}`,
      tag: `${type}:${params.matchId ?? notificationId}`,
    };
  }

  async deliver(job: Job<PushDeliveryJob>): Promise<void> {
    const { deliveryId } = job.data;
    const d = await this.db.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { user: { select: { locale: true } } } } },
    });
    if (!d || d.status !== 'PENDING' || d.channel !== 'PUSH') return;
    if (!this.transport) return this.finish(deliveryId, 'SKIPPED', 'PUSH_DISABLED');
    const n = d.notification;
    const subs = await this.liveSubscriptions(n.userId);
    if (subs.length === 0) return this.finish(deliveryId, 'SKIPPED', 'NO_DEVICES');

    const type = n.type as NotificationType;
    const message = await this.message(n.id, type, n.params as Record<string, string>, n.user.locale);
    const payload = JSON.stringify(message);
    const opts = sendOptions(type, message.tag);

    let sent = 0;
    let transient = 0;
    let rejected = 0;
    for (const s of subs) {
      try {
        const r = await this.transport.send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          opts,
        );
        if (r.statusCode >= 200 && r.statusCode < 300) {
          sent += 1;
          await this.db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
        } else if (r.statusCode === 404 || r.statusCode === 410) {
          await this.db.pushSubscription.deleteMany({ where: { id: s.id } });
        } else if (r.statusCode === 429 || r.statusCode >= 500) {
          transient += 1;
        } else {
          rejected += 1;
          this.logger.warn({ deliveryId, statusCode: r.statusCode }, 'Push rejected by the push service');
        }
      } catch (e) {
        if (e instanceof PushEndpointRejected) {
          // Адрес push-службы оказался внутренним: такая подписка больше не используется.
          this.logger.warn({ deliveryId, err: e }, 'Push endpoint rejected');
          await this.db.pushSubscription.deleteMany({ where: { id: s.id } });
        } else {
          transient += 1;
          this.logger.warn({ deliveryId, err: e }, 'Push send failed');
        }
      }
    }
    if (sent > 0) return this.finish(deliveryId, 'SENT', null);
    if (transient === 0)
      return rejected > 0
        ? this.finish(deliveryId, 'FAILED', 'PUSH_REJECTED')
        : this.finish(deliveryId, 'SKIPPED', 'NO_DEVICES');
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
      return this.finish(deliveryId, 'FAILED', 'SEND_FAILED');
    await this.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { attempts: { increment: 1 } },
    });
    throw new PushTransientError('push delivery will be retried');
  }
}
