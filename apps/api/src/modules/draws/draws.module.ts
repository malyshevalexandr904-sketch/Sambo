import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { BracketsModule } from '../brackets';
import { CategoriesModule } from '../categories';
import { CompetitionsModule } from '../competitions';
import { DrawsController } from './api/draws.controller';
import { DrawLifecycle } from './application/draw-lifecycle';
import { DrawParticipantsService } from './application/draw-participants';
import { DrawQueriesService } from './application/draw-queries';
import { DrawsService } from './application/draws.service';

/**
 * Жеребьёвка (Phase 5a; ADR-11): детерминированный генератор, посев, BYE, разведение по клубам и регионам,
 * черновик → публикация → новая версия с причиной, проверка повтора по seed.
 */
@Module({
  imports: [AuditModule, BracketsModule, CategoriesModule, CompetitionsModule],
  controllers: [DrawsController],
  providers: [DrawParticipantsService, DrawQueriesService, DrawsService, DrawLifecycle],
})
export class DrawsModule {}
