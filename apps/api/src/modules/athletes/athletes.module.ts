import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { CoachesModule } from '../coaches';
import { FilesModule } from '../files';
import { OrganizationsModule } from '../organizations';
import { PeopleModule } from '../people';
import { AdminAthletesController } from './api/admin-athletes.controller';
import { AthletesController } from './api/athletes.controller';
import { GuardiansController, MyAthletesController } from './api/guardians.controller';
import { ImportsController } from './api/imports.controller';
import { AthleteAccessService } from './application/athlete-access.service';
import { AthleteExtensions } from './application/athlete-extensions';
import { AthleteLinksService } from './application/athlete-links.service';
import { AthletesService } from './application/athletes.service';
import { GuardiansService } from './application/guardians.service';
import { ImportsService } from './application/imports.service';
import { AthleteMergeService } from './application/merge.service';

/**
 * Спортсмены: профиль, членства, тренеры, разряды, законные представители (модуль guardians архитектуры
 * объединён со спортсменами: политика GUARDIAN нужна карточке, а представителям — область спортсмена), импорт.
 */
@Module({
  imports: [AuthModule, CoachesModule, FilesModule, OrganizationsModule, PeopleModule],
  controllers: [
    ImportsController,
    AthletesController,
    GuardiansController,
    MyAthletesController,
    AdminAthletesController,
  ],
  providers: [
    AthleteAccessService,
    AthleteExtensions,
    AthletesService,
    AthleteLinksService,
    GuardiansService,
    ImportsService,
    AthleteMergeService,
  ],
  exports: [AthleteAccessService, AthleteExtensions, AthletesService],
})
export class AthletesModule {}
