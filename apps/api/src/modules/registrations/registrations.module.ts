import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { AuditModule } from '../audit';
import { CategoriesModule } from '../categories';
import { CoachesModule } from '../coaches';
import { CompetitionsModule } from '../competitions';
import { OrganizationsModule } from '../organizations';
import {
  ApplicationsController,
  CompetitionRegistrationsController,
  EntriesController,
  MyRegistrationsController,
} from './api/registrations.controller';
import { ApplicationsService } from './application/applications.service';
import { EligibilityService } from './application/eligibility.service';
import { EntriesService } from './application/entries.service';
import { EntryDecisionsService } from './application/entry-decisions.service';
import { EntriesExportService } from './application/export.service';
import { RegistrationAccessService } from './application/registration-access.service';
import { RegistrationLifecycle } from './application/registration-lifecycle';

/** Заявки и участия (Phase 4a): Application / Entry, совместимость, решения секретариата, выгрузка. */
@Module({
  imports: [
    AthletesModule,
    AuditModule,
    CategoriesModule,
    CoachesModule,
    CompetitionsModule,
    OrganizationsModule,
  ],
  controllers: [
    CompetitionRegistrationsController,
    ApplicationsController,
    EntriesController,
    MyRegistrationsController,
  ],
  providers: [
    RegistrationAccessService,
    EligibilityService,
    EntriesService,
    EntryDecisionsService,
    ApplicationsService,
    EntriesExportService,
    RegistrationLifecycle,
  ],
  exports: [RegistrationAccessService],
})
export class RegistrationsModule {}
