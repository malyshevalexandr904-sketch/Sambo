import { Controller, Delete, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  ApplicationCreate,
  type ApplicationDto,
  ApplicationPatch,
  ApplicationsQuery,
  type ApplicationSummary,
  ApplicationTransitionRequest,
  type AthleteEntryDto,
  type DataEnvelope,
  EligibleCategoriesQuery,
  type EligibleCategoriesDto,
  EntriesExportQuery,
  EntriesQuery,
  EntryCreate,
  EntryDecisionRequest,
  type EntryDto,
  EntryTransferRequest,
  EntryWithdrawRequest,
  MyApplicationsQuery,
  type Page,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { ApplicationsService } from '../application/applications.service';
import { EligibilityService } from '../application/eligibility.service';
import { EntriesService } from '../application/entries.service';
import { EntriesExportService } from '../application/export.service';

const COMP = { resolver: 'competition', param: 'id' };
const ENTRY = { resolver: 'entry', param: 'id' };

/**
 * Заявки и участники турнира (API.md, 5.3). Владелец заявки (APPLICATION_OWNER) и персонал турнира
 * проверяются в сервисах: право зависит и от организации заявки, и от турнира.
 */
@Controller('competitions/:id')
export class CompetitionRegistrationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly entries: EntriesService,
    private readonly eligibility: EligibilityService,
    private readonly exporter: EntriesExportService,
  ) {}

  @Get('eligible-categories')
  @Authenticated()
  async eligibleCategories(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(EligibleCategoriesQuery) q: EligibleCategoriesQuery,
  ): Promise<DataEnvelope<EligibleCategoriesDto>> {
    return ok(await this.eligibility.eligibleCategories(user, id, q));
  }

  @Post('applications')
  @Authenticated()
  async createApplication(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ApplicationCreate) body: ApplicationCreate,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<ApplicationDto>> {
    const app = await this.applications.create(user, id, body);
    res.setHeader('ETag', etag(app.version));
    return ok(app);
  }

  @Get('applications')
  @Authenticated()
  listApplications(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(ApplicationsQuery) q: ApplicationsQuery,
  ): Promise<Page<ApplicationSummary>> {
    return this.applications.listForCompetition(user, id, q);
  }

  @Get('entries')
  @Authenticated()
  listEntries(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(EntriesQuery) q: EntriesQuery,
  ): Promise<Page<EntryDto>> {
    return this.entries.listForCompetition(user, id, q);
  }

  @Get('entries/export.csv')
  @RequirePermission('registration.export', COMP)
  async exportEntries(
    @UuidParam('id') id: string,
    @ValidQuery(EntriesExportQuery) q: EntriesExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.exporter.csv(id, q, RequestContextStore.current().locale);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return file.content;
  }
}

@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly entries: EntriesService,
  ) {}

  private send(res: Response, app: ApplicationDto): DataEnvelope<ApplicationDto> {
    res.setHeader('ETag', etag(app.version));
    return ok(app);
  }

  @Get(':id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<ApplicationDto>> {
    return this.send(res, await this.applications.get(user, id));
  }

  @Patch(':id')
  @Authenticated()
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(ApplicationPatch) body: ApplicationPatch,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<ApplicationDto>> {
    return this.send(res, await this.applications.update(user, id, version, body));
  }

  @Post(':id/transitions')
  @Authenticated()
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(ApplicationTransitionRequest) body: ApplicationTransitionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<ApplicationDto>> {
    return this.send(res, await this.applications.transition(user, id, version, body));
  }

  @Post(':id/entries')
  @Authenticated()
  async addEntry(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(EntryCreate) body: EntryCreate,
  ): Promise<DataEnvelope<EntryDto>> {
    return ok(await this.entries.add(user, id, body));
  }

  @Delete(':id/entries/:entryId')
  @Authenticated()
  @HttpCode(204)
  async removeEntry(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('entryId') entryId: string,
  ): Promise<void> {
    await this.entries.remove(user, id, entryId);
  }
}

@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  /** Одобрение — `registration.approve`, отклонение — `registration.reject` (в сервисе по решению). */
  @Post(':id/decision')
  @Authenticated()
  @WriteAuthority(ENTRY)
  @HttpCode(200)
  async decide(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(EntryDecisionRequest) body: EntryDecisionRequest,
  ): Promise<DataEnvelope<EntryDto>> {
    return ok(await this.entries.decide(user, id, version, body));
  }

  /** Владелец заявки — до окончания регистрации; персонал — `entry.withdraw`. */
  @Post(':id/withdraw')
  @Authenticated()
  @WriteAuthority(ENTRY)
  @HttpCode(200)
  async withdraw(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(EntryWithdrawRequest) body: EntryWithdrawRequest,
  ): Promise<DataEnvelope<EntryDto>> {
    return ok(await this.entries.withdraw(user, id, version, body));
  }

  @Post(':id/transfer-category')
  @RequirePermission('entry.transfer', ENTRY)
  @WriteAuthority(ENTRY)
  @HttpCode(200)
  async transfer(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(EntryTransferRequest) body: EntryTransferRequest,
  ): Promise<DataEnvelope<EntryDto>> {
    return ok(await this.entries.transfer(user, id, version, body));
  }

  @Post(':id/refresh-snapshot')
  @Authenticated()
  @HttpCode(200)
  async refreshSnapshot(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<EntryDto>> {
    return ok(await this.entries.refreshSnapshot(user, id, version));
  }
}

@Controller()
export class MyRegistrationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly entries: EntriesService,
  ) {}

  /** Заявки организаций пользователя по всем турнирам (кабинет тренера и клуба). */
  @Get('me/applications')
  @Authenticated()
  myApplications(
    @CurrentUser() user: AuthUser,
    @ValidQuery(MyApplicationsQuery) q: MyApplicationsQuery,
  ): Promise<Page<ApplicationSummary>> {
    return this.applications.listMine(user, q);
  }

  /** Участия спортсмена: тем, кто видит карточку спортсмена (организация, SELF, GUARDIAN). */
  @Get('athletes/:athleteId/entries')
  @Authenticated()
  async athleteEntries(
    @CurrentUser() user: AuthUser,
    @UuidParam('athleteId') athleteId: string,
  ): Promise<DataEnvelope<AthleteEntryDto[]>> {
    return ok(await this.entries.listForAthlete(user, athleteId));
  }
}
