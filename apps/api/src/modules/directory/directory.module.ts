import { Module } from '@nestjs/common';
import { DivisionsModule } from '../divisions';
import { FilesModule } from '../files';
import { RatingModule } from '../rating';
import { ResultsModule } from '../results';
import { DirectoryController } from './api/directory.controller';
import { DirectoryService } from './application/directory.service';
import { RefereeExperienceService } from './application/referee-experience.service';

@Module({
  imports: [DivisionsModule, FilesModule, RatingModule, ResultsModule],
  controllers: [DirectoryController],
  providers: [DirectoryService, RefereeExperienceService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
