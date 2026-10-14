import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { RegistrationsModule } from '../registrations';
import { FollowsController } from './api/follows.controller';
import { FollowsService } from './application/follows.service';

/**
 * Подписки на спортсменов (Phase 8b): «Уведомлять о схватках». Уведомления по подпискам создаёт worker; здесь —
 * учёт подписок с проверкой доступа к спортсмену и заявке.
 */
@Module({
  imports: [AthletesModule, RegistrationsModule],
  controllers: [FollowsController],
  providers: [FollowsService],
})
export class FollowsModule {}
