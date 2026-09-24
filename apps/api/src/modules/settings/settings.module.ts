import { Global, Module } from '@nestjs/common';
import { SettingsController } from './api/settings.controller';
import { SettingsService } from './application/settings.service';

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
