import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations';
import { PeopleModule } from '../people';
import { CoachesController } from './api/coaches.controller';
import { CoachesService } from './application/coaches.service';

@Module({
  imports: [OrganizationsModule, PeopleModule],
  controllers: [CoachesController],
  providers: [CoachesService],
  exports: [CoachesService],
})
export class CoachesModule {}
