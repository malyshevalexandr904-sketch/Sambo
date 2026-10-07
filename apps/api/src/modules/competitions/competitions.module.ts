import { Module, type OnModuleInit } from '@nestjs/common';
import { PolicyService } from '../access';
import { AuditModule } from '../audit';
import { AuthModule } from '../auth';
import { FilesModule, FilesService, type UploadPurposePolicy } from '../files';
import { OrganizationsModule } from '../organizations';
import { RuleSetsModule } from '../rulesets';
import { CompetitionInvitesController, CompetitionsController } from './api/competitions.controller';
import { CompetitionExtensions } from './application/competition-extensions';
import { CompetitionScopeService } from './application/competition-scope.service';
import { CompetitionStatusWriter } from './application/competition-status.writer';
import { CompetitionReferences } from './application/competition-references';
import { CompetitionsService } from './application/competitions.service';
import { RegulationService } from './application/regulation.service';
import { StaffService } from './application/staff.service';

/**
 * Турниры (Phase 4a): турнир, машина состояний, положение, персонал. Категории, требования и заявки подключаются
 * к жизненному циклу турнира через CompetitionExtensions.
 */
@Module({
  imports: [OrganizationsModule, FilesModule, AuthModule, RuleSetsModule, AuditModule],
  controllers: [CompetitionsController, CompetitionInvitesController],
  providers: [
    CompetitionScopeService,
    CompetitionExtensions,
    CompetitionReferences,
    CompetitionStatusWriter,
    CompetitionsService,
    RegulationService,
    StaffService,
  ],
  exports: [CompetitionScopeService, CompetitionExtensions, CompetitionStatusWriter, CompetitionsService],
})
export class CompetitionsModule implements OnModuleInit {
  constructor(
    private readonly files: FilesService,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit(): void {
    // Положение (PDF) и логотип турнира — публичные медиа; прикрепляет их к турниру `competition.update`.
    const canUpload: UploadPurposePolicy = async (user) =>
      user.emailVerified &&
      ((await this.policy.holdsAnywhere(user, 'competition.update')) ||
        (await this.policy.holdsAnywhere(user, 'competition.create')));
    this.files.registerUploadPolicy('REGULATION', canUpload);
    this.files.registerUploadPolicy('COMPETITION_LOGO', canUpload);
  }
}
