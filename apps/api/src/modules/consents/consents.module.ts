import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { CompetitionsModule } from '../competitions';
import { DocumentsModule } from '../documents';
import { PeopleModule } from '../people';
import {
  AdminConsentTemplatesController,
  ConsentsController,
  ConsentTemplatesController,
} from './api/consents.controller';
import { ConsentsService } from './application/consents.service';
import { ConsentTemplatesService } from './application/consent-templates.service';

@Module({
  imports: [AthletesModule, CompetitionsModule, DocumentsModule, PeopleModule],
  controllers: [ConsentTemplatesController, AdminConsentTemplatesController, ConsentsController],
  providers: [ConsentsService, ConsentTemplatesService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
