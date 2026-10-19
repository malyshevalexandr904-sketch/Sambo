import { Module } from '@nestjs/common';
import { AdminRatingController } from './api/admin-rating.controller';
import { CompetitionRatingResultsService } from './application/competition-rating-results.service';
import { CompetitionRatingService } from './application/competition-rating.service';
import { RatingCalculationService } from './application/rating-calculation.service';
import { RatingRankingsService } from './application/rating-rankings.service';
import { RatingRulesService } from './application/rating-rules.service';

/** Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md). */
@Module({
  controllers: [AdminRatingController],
  providers: [
    RatingRulesService,
    RatingCalculationService,
    RatingRankingsService,
    CompetitionRatingService,
    CompetitionRatingResultsService,
  ],
  exports: [
    RatingRulesService,
    RatingCalculationService,
    RatingRankingsService,
    CompetitionRatingService,
    CompetitionRatingResultsService,
  ],
})
export class RatingModule {}
