import { Module } from '@nestjs/common';
import { CompetitionScopeService } from './application/competition-scope.service';

/** Турниры. Phase 3 — только область турнира для проверки прав документов; остальное — Phase 4. */
@Module({ providers: [CompetitionScopeService], exports: [CompetitionScopeService] })
export class CompetitionsModule {}
