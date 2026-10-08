import { Module } from '@nestjs/common';
import { BracketsModule } from '../brackets';
import { CategoriesModule } from '../categories';
import { CompetitionsModule } from '../competitions';
import { MatchesModule } from '../matches';
import { RegistrationsModule } from '../registrations';
import { ResultsModule } from '../results';
import { SchedulingModule } from '../scheduling';
import { MatchesController } from './api/matches.controller';
import { OfficiatingController } from './api/officiating.controller';
import { AmendService } from './application/amend.service';
import { ManualMatchesService } from './application/manual-matches.service';
import { MatchCommandsService } from './application/match-commands.service';
import { MedicalIncidentsService } from './application/medical-incidents.service';
import { ProtocolsService } from './application/protocols.service';
import { MatchContextService } from './application/match-context.service';
import { MatchQueriesService } from './application/match-queries.service';
import { ResultsService } from './application/results.service';
import { ScoringService } from './application/scoring.service';
import { WithdrawalsService } from './application/withdrawals.service';

/**
 * Судейство (Phase 7a; ARCHITECTURE.md, 14.6, 16.6): машина состояний схватки, журнал событий и счёт, результат и
 * его подтверждение, неявки снятых участников, планшет ковра и подтверждение результатов. Поверх сеток (продвижение),
 * расписания (бригады, места схваток), заявок (участник «на ковре»), турниров и категорий (статусы первой схватки).
 * Phase 7b: изменение подтверждённого результата, врач на ковре, ручная схватка, перенос и отмена, протоколы;
 * итоги категории пересчитывает модуль results по вызову отсюда. Хранение схватки — модуль matches.
 */
@Module({
  imports: [
    BracketsModule,
    CategoriesModule,
    CompetitionsModule,
    MatchesModule,
    RegistrationsModule,
    ResultsModule,
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
    AmendService,
    MedicalIncidentsService,
    ManualMatchesService,
    ProtocolsService,
  ],
})
export class RefereeingModule {}
