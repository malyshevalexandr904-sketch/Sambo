import { Module } from '@nestjs/common';
import { RatingCalculationService } from './application/rating-calculation.service';
import { RatingRankingsService } from './application/rating-rankings.service';
import { RatingRulesService } from './application/rating-rules.service';

/** Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md). */
@Module({
  providers: [RatingRulesService, RatingCalculationService, RatingRankingsService],
  exports: [RatingRulesService, RatingCalculationService, RatingRankingsService],
})
export class RatingModule {}
