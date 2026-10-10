import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes';
import { BracketsModule } from '../brackets';
import { CategoriesModule } from '../categories';
import { CompetitionsModule } from '../competitions';
import { ResultsController } from './api/results.controller';
import { CategoryResultsService } from './application/category-results.service';
import { ResultsLifecycle } from './application/results-lifecycle';
import { ResultsQueriesService } from './application/results-queries.service';

/**
 * Итоги (Phase 7b): места и медали категорий, публикация результатов, история спортсменов, условие завершения
 * турнира. Пересчёт итогов вызывает судейство (refereeing) после изменения сетки.
 */
@Module({
  imports: [AthletesModule, BracketsModule, CategoriesModule, CompetitionsModule],
  controllers: [ResultsController],
  providers: [CategoryResultsService, ResultsQueriesService, ResultsLifecycle],
  exports: [CategoryResultsService],
})
export class ResultsModule {}
