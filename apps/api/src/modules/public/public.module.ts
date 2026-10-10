import { Module } from '@nestjs/common';
import { FilesModule } from '../files';
import { RefereeingModule } from '../refereeing';
import { PublicCompetitionsController } from './api/public-competitions.controller';
import { PublicScoreboardController } from './api/public-scoreboard.controller';
import { PublicCompetitionsService } from './application/public-competitions.service';

/** Публичные read-модели и `/api/public/v1` (ADR-15). Phase 4a — турнир и положение; Phase 8a — табло
 * ковра; полная витрина — Phase 9. */
@Module({
  imports: [FilesModule, RefereeingModule],
  controllers: [PublicCompetitionsController, PublicScoreboardController],
  providers: [PublicCompetitionsService],
})
export class PublicModule {}
