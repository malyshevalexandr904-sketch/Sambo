import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { AdminController } from './api/admin.controller';
import { AdminUsersService } from './application/admin-users.service';

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminUsersService] })
export class AdminModule {}
