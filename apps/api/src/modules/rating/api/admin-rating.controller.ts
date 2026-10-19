import { Controller, Get } from '@nestjs/common';
import {
  type DataEnvelope,
  type Page,
  type RatingAthleteHit,
  RatingAthletesQuery,
  type RatingCalculationEntry,
  RatingCalculationsQuery,
  type RatingDashboard,
  type RatingRuleSetSummary,
} from '@sde/contracts';
import { ok } from '../../../common/http/http';
import { ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { CompetitionRatingService } from '../application/competition-rating.service';
import { RatingAuditService } from '../application/rating-audit.service';

/** Рейтинг в кабинете администратора платформы (docs/RATING_ARCHITECTURE.md, 8). */
@Controller('admin/rating')
export class AdminRatingController {
  constructor(
    private readonly competitions: CompetitionRatingService,
    private readonly audit: RatingAuditService,
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
}
