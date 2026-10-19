import { Module } from '@nestjs/common';
import { FilesModule } from '../files';
import { RatingModule } from '../rating';
import { RefereeingModule } from '../refereeing';
import { PublicCompetitionsController } from './api/public-competitions.controller';
import { PublicRankingsController } from './api/public-rankings.controller';
import { PublicScoreboardController } from './api/public-scoreboard.controller';
import { PublicCompetitionsService } from './application/public-competitions.service';

/** Публичные read-модели и `/api/public/v1` (ADR-15). Phase 4a — турнир и положение; Phase 8a — табло
 * ковра; полная витрина — Phase 9; таблица рейтинга — фаза 7 рейтинга. */
@Module({
  imports: [FilesModule, RatingModule, RefereeingModule],
  controllers: [PublicCompetitionsController, PublicRankingsController, PublicScoreboardController],
  providers: [PublicCompetitionsService],
})
export class PublicModule {}
