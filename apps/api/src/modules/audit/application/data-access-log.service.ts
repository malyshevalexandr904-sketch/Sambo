// Журнал доступа к документам и медданным (раздел 37 ТЗ; ARCHITECTURE.md, 11).
import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sde/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type AccessAction = 'VIEW' | 'DOWNLOAD' | 'DENIED';

@Injectable()
export class DataAccessLogService {
  constructor(private readonly db: PrismaService) {}

  /** Пишется отдельно от транзакции: отказ в доступе тоже фиксируется, хотя команда откатывается. */
  async record(action: AccessAction, resourceType: string, resourceId: string, competitionId: string | null = null): Promise<void> {
    const ctx = RequestContextStore.current();
    await this.db.dataAccessLog.create({
      data: {
        id: uuidv7(),
        userId: ctx.user?.id ?? null,
        action,
        resourceType,
        resourceId,
        competitionId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
  }
}
