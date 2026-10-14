import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { RegistrationsModule } from '../registrations';
import { NotificationsController } from './api/notifications.controller';
import { PushController } from './api/push.controller';
import { NotificationsService } from './application/notifications.service';
import { PushService } from './application/push.service';

/**
 * Уведомления (Phase 4b): лента, прочтение, настройки; Phase 8b — устройства Web Push. Создание и доставку ведёт
 * worker по событиям outbox.
 */
@Module({
  imports: [AthletesModule, RegistrationsModule],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService],
})
export class NotificationsModule {}
