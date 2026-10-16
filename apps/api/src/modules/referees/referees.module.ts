import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { RefereesController } from './api/referees.controller';
import { RefereesService } from './application/referees.service';

@Module({
  imports: [PeopleModule],
  controllers: [RefereesController],
  providers: [RefereesService],
  exports: [RefereesService],
})
export class RefereesModule {}
