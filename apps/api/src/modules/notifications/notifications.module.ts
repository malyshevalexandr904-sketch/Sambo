import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations';
import { NotificationsController } from './api/notifications.controller';
import { NotificationsService } from './application/notifications.service';

/** Уведомления (Phase 4b): лента, прочтение, настройки. Создание и доставку ведёт worker по событиям outbox. */
@Module({
  imports: [RegistrationsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
