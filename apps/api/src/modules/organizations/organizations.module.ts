import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { InvitesController, OrganizationsController } from './api/organizations.controller';
import { MembersService } from './application/members.service';
import { OrganizationScopeService } from './application/organization-scope.service';
import { OrganizationsService } from './application/organizations.service';
import { ClosureRepository } from './infrastructure/closure.repository';

@Module({
  imports: [AuthModule, FilesModule],
  controllers: [OrganizationsController, InvitesController],
  providers: [OrganizationsService, MembersService, OrganizationScopeService, ClosureRepository],
  exports: [OrganizationScopeService],
})
export class OrganizationsModule {}
