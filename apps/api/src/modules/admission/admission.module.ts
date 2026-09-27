import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { AuditModule } from '../audit';
import { CategoriesModule } from '../categories';
import { CompetitionsModule } from '../competitions';
import { ConsentsModule } from '../consents';
import { DocumentsModule } from '../documents';
import { RegistrationsModule } from '../registrations';
import { AdmissionController } from './api/admission.controller';
import { AdmissionEngine } from './application/admission-engine';
import { AdmissionLifecycle } from './application/admission-lifecycle';
import { AdmissionSources } from './application/admission-sources';
import { AdmissionService } from './application/admission.service';

/**
 * Допуск (Phase 4b; G-06): проверки по требованиям положения, пересчёт в транзакции изменения-повода,
 * исключение с причиной. Прибытие, взвешивание и медицина подключаются источниками (AdmissionSources).
 */
@Module({
  imports: [
    AthletesModule,
    AuditModule,
    CategoriesModule,
    CompetitionsModule,
    ConsentsModule,
    DocumentsModule,
    RegistrationsModule,
  ],
  controllers: [AdmissionController],
  providers: [AdmissionSources, AdmissionEngine, AdmissionService, AdmissionLifecycle],
  exports: [AdmissionSources, AdmissionService],
})
export class AdmissionModule {}
