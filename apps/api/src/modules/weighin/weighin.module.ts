import { Module } from '@nestjs/common';
import { AdmissionModule } from '../admission';
import { AuditModule } from '../audit';
import { CategoriesModule } from '../categories';
import { CheckInModule } from '../checkin';
import { CompetitionsModule } from '../competitions';
import { RegistrationsModule } from '../registrations';
import { WeighInController, WeighInSetupController } from './api/weighin.controller';
import { WeighInLifecycle } from './application/weighin-lifecycle';
import { WeighInRecords } from './application/weighin-records';
import { WeighInSetupService } from './application/weighin-setup.service';
import { WeighInQuickService } from './application/weighin-quick.service';
import { WeighInService } from './application/weighin.service';

/** Взвешивание (Phase 4b; D-06): весы, окна, попытки append-only, итог и проверка WEIGHT в допуске. */
@Module({
  imports: [
    AdmissionModule,
    AuditModule,
    CategoriesModule,
    CheckInModule,
    CompetitionsModule,
    RegistrationsModule,
  ],
  controllers: [WeighInSetupController, WeighInController],
  providers: [WeighInRecords, WeighInSetupService, WeighInService, WeighInQuickService, WeighInLifecycle],
})
export class WeighInModule {}
