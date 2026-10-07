import { Module } from '@nestjs/common';
import { BracketsModule } from '../brackets';
import { CategoriesModule } from '../categories';
import { CompetitionsModule } from '../competitions';
import { MatchesModule } from '../matches';
import { RegistrationsModule } from '../registrations';
import { SchedulingModule } from '../scheduling';
import { MatchesController } from './api/matches.controller';
import { OfficiatingController } from './api/officiating.controller';
import { MatchCommandsService } from './application/match-commands.service';
import { MatchContextService } from './application/match-context.service';
import { MatchQueriesService } from './application/match-queries.service';
import { ResultsService } from './application/results.service';
import { ScoringService } from './application/scoring.service';
import { WithdrawalsService } from './application/withdrawals.service';

/**
 * Судейство (Phase 7a; ARCHITECTURE.md, 14.6, 16.6): машина состояний схватки, журнал событий и счёт, результат и
 * его подтверждение, неявки снятых участников, планшет ковра и подтверждение результатов. Поверх сеток (продвижение),
 * расписания (бригады, места схваток), заявок (участник «на ковре»), турниров и категорий (статусы первой схватки).
 * Хранение схватки — модуль matches.
 */
@Module({
  imports: [
    BracketsModule,
    CategoriesModule,
    CompetitionsModule,
    MatchesModule,
    RegistrationsModule,
    SchedulingModule,
  ],
  controllers: [MatchesController, OfficiatingController],
  providers: [
    MatchContextService,
    MatchQueriesService,
    MatchCommandsService,
    ScoringService,
    ResultsService,
    WithdrawalsService,
  ],
})
export class RefereeingModule {}
