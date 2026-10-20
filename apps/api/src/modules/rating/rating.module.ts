import { Module } from '@nestjs/common';
import {
  AdminAthleteRatingController,
  AdminCompetitionRatingController,
} from './api/admin-athlete-rating.controller';
import { AdminRatingController } from './api/admin-rating.controller';
import { CompetitionRatingResultsService } from './application/competition-rating-results.service';
import { CompetitionRatingService } from './application/competition-rating.service';
import { RatingAdminService } from './application/rating-admin.service';
import { RatingAuditService } from './application/rating-audit.service';
import { RatingCalculationService } from './application/rating-calculation.service';
import { RatingProfileService } from './application/rating-profile.service';
import { RatingRankingsService } from './application/rating-rankings.service';
import { RatingRulesService } from './application/rating-rules.service';
import { RatingSeasonService } from './application/rating-season.service';

/** Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md). */
@Module({
  controllers: [AdminRatingController, AdminAthleteRatingController, AdminCompetitionRatingController],
  providers: [
    RatingRulesService,
    RatingCalculationService,
    RatingRankingsService,
    CompetitionRatingService,
    CompetitionRatingResultsService,
    RatingAdminService,
    RatingAuditService,
    RatingProfileService,
    RatingSeasonService,
  ],
  exports: [
    RatingRulesService,
    RatingCalculationService,
    RatingRankingsService,
    CompetitionRatingService,
    CompetitionRatingResultsService,
    RatingProfileService,
    RatingSeasonService,
  ],
})
export class RatingModule {}
