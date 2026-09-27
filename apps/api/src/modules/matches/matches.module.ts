import { Module } from '@nestjs/common';
import { MatchesService } from './application/matches.service';

/**
 * Схватки (Phase 5a — схватки сеток): создание при публикации жеребьёвки, стороны при продвижении по сетке.
 * Машина состояний схватки, судейство и результат — Phase 7.
 */
@Module({
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
