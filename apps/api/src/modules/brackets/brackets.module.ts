import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { MatchesModule } from '../matches';
import { BracketsService } from './application/brackets.service';

/**
 * Сетки (Phase 5a): стратегии форматов, граф опубликованной жеребьёвки, схватки узлов, продвижение и места.
 * Точка расширения «Форматы» — реестр стратегий (domain/strategies.ts).
 */
@Module({
  imports: [AuditModule, MatchesModule],
  providers: [BracketsService],
  exports: [BracketsService],
})
export class BracketsModule {}
