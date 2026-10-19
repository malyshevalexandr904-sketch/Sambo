import { Controller, Get } from '@nestjs/common';
import type { DataEnvelope, RatingRuleSetSummary } from '@sde/contracts';
import { ok } from '../../../common/http/http';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { CompetitionRatingService } from '../application/competition-rating.service';

/** Рейтинг в кабинете администратора платформы (docs/RATING_ARCHITECTURE.md, 8). */
@Controller('admin/rating')
export class AdminRatingController {
  constructor(private readonly competitions: CompetitionRatingService) {}

  /** Действующая версия правил расчёта — для экрана создания и включения рейтингового турнира. */
  @Get('rule-sets/active')
  @RequirePermission('competition.create_rated', PLATFORM_SCOPE)
  async activeRuleSet(): Promise<DataEnvelope<RatingRuleSetSummary>> {
    return ok(await this.competitions.activeSummary());
  }
}
