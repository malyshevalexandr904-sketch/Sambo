import { Global, Module } from '@nestjs/common';
import { AuditController } from './api/audit.controller';
import { AuditQueryService } from './application/audit-query.service';
import { AuditService } from './application/audit.service';
import { DataAccessLogService } from './application/data-access-log.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, DataAccessLogService],
  exports: [AuditService, AuditQueryService, DataAccessLogService],
})
export class AuditModule {}
