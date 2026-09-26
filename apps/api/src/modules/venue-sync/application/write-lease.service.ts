// Право записи турнира (ADR-21; DATABASE.md, 3.9, 7). До Phase 9.5 держатель — всегда облако, но операционные
// команды уже проверяют право: когда появится площадочный узел, облако начнёт отвечать WRITE_AUTHORITY_ELSEWHERE
// без изменения модулей турнира, категорий и заявок.
import { Injectable } from '@nestjs/common';
import type { LeaseHolder, WriteAuthority } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { holdsWriteAuthority, type Instance } from '../domain/write-authority';

/** Экземпляр API: облако. Режим площадочного узла (DEPLOYMENT_MODE=venue-node) — Phase 9.5. */
const INSTANCE: Instance = { mode: 'cloud', nodeId: null };

interface LeaseRow {
  holder_type: LeaseHolder;
  holder_node_id: string | null;
  epoch: number;
}

@Injectable()
export class WriteLeaseService {
  constructor(private readonly db: PrismaService) {}

  /** Право записи нового турнира — у облака, эпоха 1. Вызывается в транзакции создания турнира. */
  async createCloudLease(tx: Tx, competitionId: string, userId: string | null): Promise<void> {
    await tx.competitionWriteLease.create({
      data: { competitionId, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE', acquiredById: userId },
    });
  }

  async authority(competitionId: string): Promise<WriteAuthority> {
    const lease = await this.db.competitionWriteLease.findUnique({ where: { competitionId } });
    return { holder: lease?.holderType ?? 'CLOUD', epoch: lease?.epoch ?? 1 };
  }

  /** Проверка до транзакции (guard маршрута): быстрый отказ без разбора тела запроса. */
  async assertHeld(competitionId: string): Promise<void> {
    const lease = await this.db.competitionWriteLease.findUnique({ where: { competitionId } });
    if (!holdsWriteAuthority(lease, INSTANCE)) this.refuse(lease?.holderType ?? 'CLOUD', lease?.epoch ?? 1);
  }

  /**
   * Проверка внутри транзакции команды. `FOR SHARE` на строке права: передача права узлу (Phase 9.5) берёт
   * `FOR UPDATE` и ждёт завершения идущих команд, а команда после передачи увидит нового держателя.
   */
  async assertWritable(tx: Tx, competitionId: string): Promise<void> {
    const rows = await tx.$queryRaw<LeaseRow[]>`
      SELECT holder_type, holder_node_id, epoch FROM competition_write_lease
      WHERE competition_id = ${competitionId}::uuid FOR SHARE`;
    const row = rows[0];
    const lease = row
      ? { holderType: row.holder_type, holderNodeId: row.holder_node_id, epoch: row.epoch }
      : null;
    if (!holdsWriteAuthority(lease, INSTANCE)) this.refuse(row?.holder_type ?? 'CLOUD', row?.epoch ?? 1);
  }

  private refuse(holder: LeaseHolder, epoch: number): never {
    throw new DomainError('WRITE_AUTHORITY_ELSEWHERE', { holder, epoch });
  }
}
