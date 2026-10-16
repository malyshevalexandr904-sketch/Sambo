// Регистрация в системе по ролям (Phase 9a; API.md, 3.10). Заявитель — любой вошедший с подтверждённым email; решения —
// проверяющие (проверка в use case: область зависит от статуса заявки). Право тренера рассматривать заявки спортсменов
// назначает руководитель организации (`coach.manage`).
import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  CoachReviewRightsPut,
  type CoachSummary,
  type DataEnvelope,
  type DownloadUrl,
  OnboardingApprove,
  type OnboardingCoachOption,
  OnboardingCreate,
  OnboardingDocumentAttach,
  type OnboardingHistoryDto,
  type OnboardingOrganizationOption,
  OnboardingOrganizationsQuery,
  type OnboardingOverviewDto,
  OnboardingPatch,
  OnboardingReasonRequest,
  type OnboardingRequestDto,
  OnboardingReviewQuery,
  OnboardingSubmit,
  type Page,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { CoachesService } from '../../coaches';
import { OrganizationRegistryService } from '../../organizations';
import { OnboardingService } from '../application/onboarding.service';
import { OnboardingWorkflowService } from '../application/onboarding-workflow.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly workflow: OnboardingWorkflowService,
    private readonly organizations: OrganizationRegistryService,
    private readonly coaches: CoachesService,
  ) {}

  /** Кабинет: мои заявки и подтверждённые профили. */
  @Get('me')
  @Authenticated()
  async overview(@CurrentUser() user: AuthUser): Promise<DataEnvelope<OnboardingOverviewDto>> {
    return ok(await this.onboarding.overview(user));
  }

  /** Подтверждённые организации для выбора в заявке. */
  @Get('organizations')
  @Authenticated()
  async organizationOptions(
    @ValidQuery(OnboardingOrganizationsQuery) q: OnboardingOrganizationsQuery,
  ): Promise<DataEnvelope<OnboardingOrganizationOption[]>> {
    return ok(await this.organizations.selectable(q.q));
  }

  /** Тренеры организации, которых может выбрать спортсмен (подтверждённые, работающие в ней). */
  @Get('organizations/:id/coaches')
  @Authenticated()
  async coachOptions(@UuidParam('id') id: string): Promise<DataEnvelope<OnboardingCoachOption[]>> {
    if (!(await this.organizations.isSelectableNow(id)))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    return ok(await this.coaches.selectableIn(id));
  }

  @Post('requests')
  @Authenticated()
  @RateLimit('onboarding')
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(OnboardingCreate) body: OnboardingCreate,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.onboarding.create(user, body));
  }

  @Get('requests/:id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.onboarding.get(user, id));
  }

  @Patch('requests/:id')
  @Authenticated()
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OnboardingPatch) body: OnboardingPatch,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.onboarding.update(user, id, version, body));
  }

  @Get('requests/:id/history')
  @Authenticated()
  async history(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<OnboardingHistoryDto[]>> {
    return ok(await this.onboarding.history(user, id));
  }

  @Post('requests/:id/documents')
  @Authenticated()
  @RateLimit('upload')
  async attachDocument(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(OnboardingDocumentAttach) body: OnboardingDocumentAttach,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.onboarding.attachDocument(user, id, body));
  }

  @Delete('requests/:id/documents/:documentId')
  @Authenticated()
  async removeDocument(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('documentId') documentId: string,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.onboarding.removeDocument(user, id, documentId));
  }

  @Get('requests/:id/documents/:documentId/download-url')
  @Authenticated()
  async documentUrl(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('documentId') documentId: string,
  ): Promise<DataEnvelope<DownloadUrl>> {
    return ok(await this.onboarding.documentUrl(user, id, documentId));
  }

  @Post('requests/:id/submit')
  @Authenticated()
  @RateLimit('onboarding')
  @HttpCode(200)
  async submit(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OnboardingSubmit) body: OnboardingSubmit,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.workflow.submit(user, id, version, body));
  }

  @Post('requests/:id/cancel')
  @Authenticated()
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.workflow.cancel(user, id, version));
  }

  // ---------- Проверка ----------

  @Get('review')
  @Authenticated()
  review(
    @CurrentUser() user: AuthUser,
    @ValidQuery(OnboardingReviewQuery) q: OnboardingReviewQuery,
  ): Promise<Page<OnboardingRequestDto>> {
    return this.workflow.queue(user, q);
  }

  @Post('requests/:id/approve')
  @Authenticated()
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OnboardingApprove) body: OnboardingApprove,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.workflow.approve(user, id, version, body));
  }

  @Post('requests/:id/reject')
  @Authenticated()
  @HttpCode(200)
  async reject(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OnboardingReasonRequest) body: OnboardingReasonRequest,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.workflow.reject(user, id, version, body.reason));
  }

  @Post('requests/:id/request-changes')
  @Authenticated()
  @HttpCode(200)
  async requestChanges(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OnboardingReasonRequest) body: OnboardingReasonRequest,
  ): Promise<DataEnvelope<OnboardingRequestDto>> {
    return ok(await this.workflow.requestChanges(user, id, version, body.reason));
  }
}

/** Право тренера рассматривать заявки спортсменов, выбравших его: назначает и снимает руководитель организации. */
@Controller('organizations')
export class CoachReviewRightsController {
  constructor(private readonly coaches: CoachesService) {}

  @Put(':id/coaches/:coachId/athlete-review')
  @RequirePermission('coach.manage', { resolver: 'organization', param: 'id' })
  async put(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('coachId') coachId: string,
    @ValidBody(CoachReviewRightsPut) body: CoachReviewRightsPut,
  ): Promise<DataEnvelope<CoachSummary>> {
    return ok(await this.coaches.setAthleteReviewRight(user, id, coachId, body.enabled));
  }
}
