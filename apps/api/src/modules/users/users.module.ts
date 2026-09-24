import { Module } from '@nestjs/common';
import { MeController } from './api/me.controller';
import { MeService } from './application/me.service';

@Module({ controllers: [MeController], providers: [MeService], exports: [MeService] })
export class UsersModule {}
