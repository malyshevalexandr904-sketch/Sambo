import { Module } from '@nestjs/common';
import { RatingRulesService } from './application/rating-rules.service';

/** Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md). */
@Module({
  providers: [RatingRulesService],
  exports: [RatingRulesService],
})
export class RatingModule {}
