import { Module } from '@nestjs/common';
import { FilesModule } from '../files';
import { PublicCompetitionsController } from './api/public-competitions.controller';
import { PublicCompetitionsService } from './application/public-competitions.service';

/** Публичные read-модели и `/api/public/v1` (ADR-15). Phase 4a — турнир и положение; полная витрина — Phase 9. */
@Module({
  imports: [FilesModule],
  controllers: [PublicCompetitionsController],
  providers: [PublicCompetitionsService],
})
export class PublicModule {}
