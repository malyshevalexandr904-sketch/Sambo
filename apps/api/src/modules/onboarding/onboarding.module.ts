import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { CoachesModule } from '../coaches';
import { FilesModule } from '../files';
import { OrganizationsModule } from '../organizations';
import { PeopleModule } from '../people';
import { RefereesModule } from '../referees';
import { CoachReviewRightsController, OnboardingController } from './api/onboarding.controller';
import { OnboardingAccessService } from './application/onboarding-access.service';
import { OnboardingApprovalService } from './application/onboarding-approval.service';
import { OnboardingService } from './application/onboarding.service';
import { OnboardingWorkflowService } from './application/onboarding-workflow.service';

/**
 * Регистрация в системе по ролям (Phase 9a): заявки руководителя спортивной организации, тренера, спортсмена и
 * судьи, их проверка платформой или организацией, присоединение к организации позже.
 */
@Module({
  imports: [AthletesModule, CoachesModule, FilesModule, OrganizationsModule, PeopleModule, RefereesModule],
  controllers: [OnboardingController, CoachReviewRightsController],
  providers: [
    OnboardingAccessService,
    OnboardingApprovalService,
    OnboardingService,
    OnboardingWorkflowService,
  ],
  exports: [OnboardingAccessService],
})
export class OnboardingModule {}
