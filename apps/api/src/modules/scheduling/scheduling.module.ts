import { Module } from '@nestjs/common';
import { BracketsModule } from '../brackets';
import { CompetitionsModule } from '../competitions';
import { MatchesModule } from '../matches';
import { CrewsController } from './api/crews.controller';
import { MatsController } from './api/mats.controller';
import { ScheduleController } from './api/schedule.controller';
import { SessionsController } from './api/sessions.controller';
import { CrewAccessService } from './application/crew-access.service';
import { CrewsService } from './application/crews.service';
import { MatsService } from './application/mats.service';
import { ScheduleLifecycle } from './application/schedule-lifecycle';
import { ScheduleQueriesService } from './application/schedule-queries.service';
import { ScheduleService } from './application/schedule.service';
import { SessionsService } from './application/sessions.service';

/**
 * Расписание турнира (Phase 6; ARCHITECTURE.md, 14.6, 16.6; DATABASE.md, 3.7): ковры, сессии, автопланировщик,
 * ручная правка, публикация, судейские бригады, очередь ковра. Пересчёт зависимостей — через brackets
 * (BracketsService.matchDependencies), длительности и стороны схваток — через matches.
 */
@Module({
  imports: [BracketsModule, CompetitionsModule, MatchesModule],
  controllers: [MatsController, SessionsController, ScheduleController, CrewsController],
  providers: [
    MatsService,
    SessionsService,
    ScheduleQueriesService,
    ScheduleService,
    CrewsService,
    CrewAccessService,
    ScheduleLifecycle,
  ],
  exports: [ScheduleQueriesService, CrewAccessService],
})
export class SchedulingModule {}
