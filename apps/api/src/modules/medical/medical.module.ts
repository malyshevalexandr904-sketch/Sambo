import { Module } from '@nestjs/common';
import { AdmissionModule } from '../admission';
import { AthletesModule } from '../athletes';
import { AuditModule } from '../audit';
import { CompetitionsModule } from '../competitions';
import { MedicalController } from './api/medical.controller';
import { MedicalLifecycle } from './application/medical-lifecycle';
import { MedicalService } from './application/medical.service';

/** Медицинский допуск (Phase 4b; G-05, часть 1): факт, срок, кто выдал; доступ — медицинскому персоналу. */
@Module({
  imports: [AdmissionModule, AthletesModule, AuditModule, CompetitionsModule],
  controllers: [MedicalController],
  providers: [MedicalService, MedicalLifecycle],
})
export class MedicalModule {}
