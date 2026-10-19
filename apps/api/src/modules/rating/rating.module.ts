import { Module } from '@nestjs/common';
import { AdminRatingController } from './api/admin-rating.controller';
import { CompetitionRatingService } from './application/competition-rating.service';
import { RatingCalculationService } from './application/rating-calculation.service';
import { RatingRankingsService } from './application/rating-rankings.service';
import { RatingRulesService } from './application/rating-rules.service';

/** Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md). */
@Module({
  controllers: [AdminRatingController],
  providers: [RatingRulesService, RatingCalculationService, RatingRankingsService, CompetitionRatingService],
  exports: [RatingRulesService, RatingCalculationService, RatingRankingsService, CompetitionRatingService],
})
export class RatingModule {}
