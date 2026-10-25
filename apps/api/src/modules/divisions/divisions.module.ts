import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AdminDivisionsController, DivisionsController } from './api/divisions.controller';
import { DivisionsService } from './application/divisions.service';

/** Дивизионы спортсменов по возрасту (docs/RATED_ONLY.md, 4). */
@Module({
  imports: [AuditModule],
  controllers: [DivisionsController, AdminDivisionsController],
  providers: [DivisionsService],
  exports: [DivisionsService],
})
export class DivisionsModule {}
