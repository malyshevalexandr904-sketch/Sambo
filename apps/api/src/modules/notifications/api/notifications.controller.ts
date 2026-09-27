import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  type NotificationDto,
  type NotificationPreferenceDto,
  NotificationPreferencesPut,
  NotificationsQuery,
  type Page,
  type UnreadCountDto,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { NotificationsService } from '../application/notifications.service';

/** Уведомления пользователя (API.md, 5.8): только свои — права не нужны. */
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(NotificationsQuery) q: NotificationsQuery,
  ): Promise<Page<NotificationDto>> {
    return this.notifications.list(user, q);
  }

  @Get('notifications/unread-count')
  @Authenticated()
  async unread(@CurrentUser() user: AuthUser): Promise<DataEnvelope<UnreadCountDto>> {
    return ok(await this.notifications.unread(user));
  }

  @Post('notifications/read-all')
  @Authenticated()
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.readAll(user);
  }

  @Post('notifications/:id/read')
  @Authenticated()
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    await this.notifications.read(user, id);
  }

  @Get('notification-preferences')
  @Authenticated()
  async preferences(@CurrentUser() user: AuthUser): Promise<DataEnvelope<NotificationPreferenceDto[]>> {
    return ok(await this.notifications.preferences(user));
  }

  @Put('notification-preferences')
  @Authenticated()
  async putPreferences(
    @CurrentUser() user: AuthUser,
    @ValidBody(NotificationPreferencesPut) body: NotificationPreferencesPut,
  ): Promise<DataEnvelope<NotificationPreferenceDto[]>> {
    return ok(await this.notifications.putPreferences(user, body));
  }
}
