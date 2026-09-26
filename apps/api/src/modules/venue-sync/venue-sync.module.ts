import { Global, Module } from '@nestjs/common';
import { WriteAuthorityGuard } from './api/write-authority.guard';
import { WriteLeaseService } from './application/write-lease.service';

/**
 * Площадочный узел (ADR-21). Phase 4a — право записи турнира: запись о праве, проверка в командах и guard
 * маршрутов; журнал синхронизации пишут триггеры БД. Узлы, снимки и применение пачек — Phase 9.5.
 */
@Global()
@Module({
  providers: [WriteLeaseService, WriteAuthorityGuard],
  exports: [WriteLeaseService, WriteAuthorityGuard],
})
export class VenueSyncModule {}
