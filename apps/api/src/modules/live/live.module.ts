import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { CompetitionsModule } from '../competitions';
import { RefereeingModule } from '../refereeing';
import { LiveGateway } from './api/live.gateway';
import { ChangeFeedService } from './application/change-feed.service';
import { ChannelAccessService } from './application/channel-access.service';
import { LivePublisherService } from './application/live-publisher.service';
import { LiveRouterService } from './application/live-router.service';

/**
 * Живые данные (Phase 8a; ADR-07; ARCHITECTURE.md, 13): WebSocket-шлюз, права на каналы, лента изменений из
 * PostgreSQL (ведущий узел), публикация служебных «что изменилось» и публичных состояний табло. Домены о шлюзе не
 * знают: изменения приходят из журнала синхронизации, проекции табло — модуль refereeing.
 */
@Module({
  imports: [AuthModule, CompetitionsModule, RefereeingModule],
  providers: [LivePublisherService, LiveRouterService, ChangeFeedService, ChannelAccessService, LiveGateway],
  exports: [LivePublisherService, ChangeFeedService, LiveGateway],
})
export class LiveModule {}
