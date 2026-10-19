import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  type Page,
  type RatingAthleteHit,
  RatingAthletesQuery,
  type RatingCalculationEntry,
  RatingCalculationsQuery,
  type RatingDashboard,
  type RatingRuleSetSummary,
  type RatingSeason,
  RatingSeasonInput,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { CompetitionRatingService } from '../application/competition-rating.service';
import { RatingAuditService } from '../application/rating-audit.service';
import { RatingSeasonService } from '../application/rating-season.service';

/** Рейтинг в кабинете администратора платформы (docs/RATING_ARCHITECTURE.md, 8). */
@Controller('admin/rating')
export class AdminRatingController {
  constructor(
    private readonly competitions: CompetitionRatingService,
    private readonly audit: RatingAuditService,
    private readonly seasons: RatingSeasonService,
  ) {}

  /** Действующая версия правил расчёта — для экрана создания и включения рейтингового турнира. */
  @Get('rule-sets/active')
  @RequirePermission('competition.create_rated', PLATFORM_SCOPE)
  async activeRuleSet(): Promise<DataEnvelope<RatingRuleSetSummary>> {
    return ok(await this.competitions.activeSummary());
  }

  @Get('dashboard')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  async dashboard(): Promise<DataEnvelope<RatingDashboard>> {
    return ok(await this.audit.dashboard());
  }

  /** Журнал расчётов рейтинга: статус, турнир, спортсмен. */
  @Get('calculations')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  calculations(
    @ValidQuery(RatingCalculationsQuery) q: RatingCalculationsQuery,
  ): Promise<Page<RatingCalculationEntry>> {
    return this.audit.calculations(q);
  }

  @Get('athletes')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  async athletes(
    @ValidQuery(RatingAthletesQuery) q: RatingAthletesQuery,
  ): Promise<DataEnvelope<RatingAthleteHit[]>> {
    return ok(await this.audit.athletes(q));
  }

  /** Сезоны рейтинга (ТЗ 68): видит аудит рейтинга, заводит и меняет — тот, кто управляет правилами рейтинга. */
  @Get('seasons')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  async seasonList(): Promise<DataEnvelope<RatingSeason[]>> {
    return ok(await this.seasons.list());
  }

  @Post('seasons')
  @RequirePermission('competition.manage_rating_rules', PLATFORM_SCOPE)
  async createSeason(
    @CurrentUser() user: AuthUser,
    @ValidBody(RatingSeasonInput) body: RatingSeasonInput,
  ): Promise<DataEnvelope<RatingSeason>> {
    return ok(await this.seasons.create(body, user.id));
  }

  @Put('seasons/:id')
  @RequirePermission('competition.manage_rating_rules', PLATFORM_SCOPE)
  async updateSeason(
    @UuidParam('id') id: string,
    @ValidBody(RatingSeasonInput) body: RatingSeasonInput,
  ): Promise<DataEnvelope<RatingSeason>> {
    return ok(await this.seasons.update(id, body));
  }
}
