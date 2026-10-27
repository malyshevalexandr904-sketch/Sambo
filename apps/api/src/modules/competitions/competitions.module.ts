import { Module, type OnModuleInit } from '@nestjs/common';
import { PolicyService } from '../access';
import { AuditModule } from '../audit';
import { AuthModule } from '../auth';
import { FilesModule, FilesService, type UploadPurposePolicy } from '../files';
import { OrganizationsModule } from '../organizations';
import { RuleSetsModule } from '../rulesets';
import { CompetitionInvitesController, CompetitionsController } from './api/competitions.controller';
import { RefereeRecruitmentController } from './api/referee-recruitment.controller';
import { RefereeRecruitmentService } from './application/referee-recruitment.service';
import { CompetitionExtensions } from './application/competition-extensions';
import { CompetitionScopeService } from './application/competition-scope.service';
import { CompetitionStatusWriter } from './application/competition-status.writer';
import { CompetitionReferences } from './application/competition-references';
import { CompetitionsService } from './application/competitions.service';
import { RegulationService } from './application/regulation.service';
import { StaffService } from './application/staff.service';
import { RatingModule } from '../rating';
import { CompetitionRatingController } from './api/competition-rating.controller';
import { CompetitionRequestsController } from './api/competition-requests.controller';
import { CompetitionRequestsService } from './application/competition-requests.service';
import { CompetitionTypeService } from './application/competition-type.service';

/**
 * Турниры (Phase 4a): турнир, машина состояний, положение, персонал. Категории, требования и заявки подключаются
 * к жизненному циклу турнира через CompetitionExtensions.
 */
@Module({
  imports: [OrganizationsModule, FilesModule, AuthModule, RuleSetsModule, AuditModule, RatingModule],
  controllers: [
    CompetitionsController,
    CompetitionInvitesController,
    CompetitionRatingController,
    CompetitionRequestsController,
    RefereeRecruitmentController,
  ],
  providers: [
    CompetitionScopeService,
    CompetitionExtensions,
    CompetitionReferences,
    CompetitionStatusWriter,
    CompetitionsService,
    CompetitionRequestsService,
    CompetitionTypeService,
    RegulationService,
    StaffService,
    RefereeRecruitmentService,
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
        (await this.policy.holdsAnywhere(user, 'competition.create_rated')) ||
        (await this.policy.holdsAnywhere(user, 'competition.request')));
    this.files.registerUploadPolicy('REGULATION', canUpload);
    this.files.registerUploadPolicy('COMPETITION_LOGO', canUpload);
  }
}
