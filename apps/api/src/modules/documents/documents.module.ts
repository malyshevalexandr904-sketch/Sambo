import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { CoachesModule } from '../coaches';
import { CompetitionsModule } from '../competitions';
import { FilesModule } from '../files';
import { OrganizationsModule } from '../organizations';
import { DocumentsController } from './api/documents.controller';
import { DocumentAccessService } from './application/document-access.service';
import { DocumentsService } from './application/documents.service';

@Module({
  imports: [AthletesModule, CoachesModule, CompetitionsModule, FilesModule, OrganizationsModule],
  controllers: [DocumentsController],
  providers: [DocumentAccessService, DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
