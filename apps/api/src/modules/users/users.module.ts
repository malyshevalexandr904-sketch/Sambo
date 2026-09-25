import { Module } from '@nestjs/common';
import { MeController } from './api/me.controller';
import { MeService } from './application/me.service';
import { PeopleModule } from '../people';

@Module({
  imports: [PeopleModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class UsersModule {}
