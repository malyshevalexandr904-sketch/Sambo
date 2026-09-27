import { Module } from '@nestjs/common';
import { AdmissionModule } from '../admission';
import { AthletesModule } from '../athletes';
import { AuditModule } from '../audit';
import { CompetitionsModule } from '../competitions';
import { RegistrationsModule } from '../registrations';
import { CheckInController } from './api/checkin.controller';
import { CheckInLifecycle } from './application/checkin-lifecycle';
import { CheckInService } from './application/checkin.service';
import { EntryQrService } from './application/entry-qr.service';

/** Прибытие (Phase 4b; раздел 15 ТЗ): QR участника без ПДн, поиск и ручная отметка, счётчики. */
@Module({
  imports: [AdmissionModule, AthletesModule, AuditModule, CompetitionsModule, RegistrationsModule],
  controllers: [CheckInController],
  providers: [CheckInService, EntryQrService, CheckInLifecycle],
  exports: [CheckInService],
})
export class CheckInModule {}
