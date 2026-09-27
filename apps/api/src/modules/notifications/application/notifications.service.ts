// Уведомления пользователя (API.md, 5.8): лента в приложении, отметка прочтения, настройки каналов.
// Уведомления создаёт worker по событиям outbox; здесь — чтение и настройки.
import { Injectable } from '@nestjs/common';
import {
  CONFIGURABLE_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationContext,
  type NotificationDto,
  notificationLink,
  type NotificationPreferenceDto,
  type NotificationPreferencesPut,
  type NotificationsQuery,
  type NotificationType,
  type Page,
  type UnreadCountDto,
} from '@sde/contracts';
import { notificationSource, type Prisma } from '@sde/db';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RegistrationAccessService } from '../../registrations';

type Row = Prisma.NotificationGetPayload<object>;

const isType = (t: string): t is NotificationType => (NOTIFICATION_TYPES as readonly string[]).includes(t);

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly registrations: RegistrationAccessService,
  ) {}

  /**
   * Подстановки на момент чтения. Сведения о заявке — только пока пользователь владелец её организации
   * (ушёл из клуба — видит лишь название турнира).
   */
  private async context(
    user: AuthUser,
    type: NotificationType,
    params: Record<string, string>,
  ): Promise<NotificationContext> {
    const locale = RequestContextStore.current().locale === 'en' ? 'en' : 'ru';
    const { organizationId, ...source } = await notificationSource(this.db, type, params, locale);
    if (organizationId && !(await this.registrations.isOwner(user, organizationId)))
      return { competitionName: source.competitionName };
    return source;
  }

  private async toDto(user: AuthUser, r: Row): Promise<NotificationDto | null> {
    if (!isType(r.type)) return null;
    const params = (r.params ?? {}) as Record<string, string>;
    return {
      id: r.id,
      type: r.type,
      params,
      context: await this.context(user, r.type, params),
      link: notificationLink(r.type, params),
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    };
  }

  async list(user: AuthUser, q: NotificationsQuery): Promise<Page<NotificationDto>> {
    const and: Prisma.NotificationWhereInput[] = [{ userId: user.id }];
    if (q.unreadOnly) and.push({ readAt: null });
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      const at = new Date(cursor.k);
      and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] });
    }
    const rows = await this.db.notification.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.createdAt.toISOString(), id: r.id }),
      (r) => r,
    );
    const data: NotificationDto[] = [];
    for (const r of page.data) {
      const dto = await this.toDto(user, r);
      if (dto) data.push(dto);
    }
    return { data, page: page.page };
  }

  async unread(user: AuthUser): Promise<UnreadCountDto> {
    return { unread: await this.db.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  async read(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.db.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0 && !(await this.db.notification.findFirst({ where: { id, userId: user.id } })))
      throw new DomainError('NOT_FOUND', { resource: 'notification' });
  }

  async readAll(user: AuthUser): Promise<void> {
    await this.db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Настройки по всем типам и настраиваемым каналам; строки нет — канал включён. */
  async preferences(user: AuthUser): Promise<NotificationPreferenceDto[]> {
    const rows = await this.db.notificationPreference.findMany({ where: { userId: user.id } });
    const stored = new Map(rows.map((r) => [`${r.type}:${r.channel}`, r.enabled]));
    return NOTIFICATION_TYPES.flatMap((type) =>
      CONFIGURABLE_CHANNELS.map((channel) => ({
        type,
        channel,
        enabled: stored.get(`${type}:${channel}`) ?? true,
      })),
    );
  }

  async putPreferences(
    user: AuthUser,
    input: NotificationPreferencesPut,
  ): Promise<NotificationPreferenceDto[]> {
    await this.db.tx(async (tx) => {
      for (const p of input.preferences)
        await tx.notificationPreference.upsert({
          where: { userId_type_channel: { userId: user.id, type: p.type, channel: p.channel } },
          create: { userId: user.id, type: p.type, channel: p.channel, enabled: p.enabled },
          update: { enabled: p.enabled },
        });
    });
    return this.preferences(user);
  }
}
