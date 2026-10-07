import { Module } from '@nestjs/common';
import { MatchStoreService } from './application/match-store.service';
import { MatchesService } from './application/matches.service';

/**
 * Схватки — хранение агрегата схватки (match, match_participant, match_event, match_result): схватки сеток (5a),
 * состояние, журнал и результат (7a). Правила судейства — модуль refereeing поверх сеток и расписания.
 */
@Module({
  providers: [MatchesService, MatchStoreService],
  exports: [MatchesService, MatchStoreService],
})
export class MatchesModule {}
