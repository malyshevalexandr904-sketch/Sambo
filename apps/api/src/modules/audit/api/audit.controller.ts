import { Controller, Get } from '@nestjs/common';
import { AuditLogsQuery, type AuditEntry, type Page } from '@sde/contracts';
import { ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { AuditQueryService } from '../application/audit-query.service';

@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  /** Журнал аудита платформы (API.md, 3.6). Журнал турнира — `/competitions/{id}/audit-logs` с Phase 4. */
  @Get()
  @RequirePermission('audit.view', PLATFORM_SCOPE)
  list(@ValidQuery(AuditLogsQuery) query: AuditLogsQuery): Promise<Page<AuditEntry>> {
    return this.audit.list(query);
  }
}
