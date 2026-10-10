// Снятие участника системой по ходу схватки (Phase 7b): врач снял спортсмена с ковра. Вызывающий держит блокировку
// категории и уже освободил участие от идущей схватки (результат «травма» внесён); оставшиеся схватки участника
// решит неявкой подписчик события `registration.entry_withdrawn` (модуль судейства) в той же транзакции.
import { Injectable } from '@nestjs/common';
import type { Tx } from '@sde/db';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { isActiveEntry } from '../domain/entry-rules';
import { lockApplication, lockEntry } from './entry-commands';

@Injectable()
export class EntryWithdrawalService {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Участие снимается (порядок блокировок — заявка, затем участие); уже снятое — ничего не делает. */
  async withdrawBySystem(tx: Tx, entryId: string, userId: string, reason: string): Promise<boolean> {
    const current = await tx.entry.findUniqueOrThrow({
      where: { id: entryId },
      select: { applicationId: true },
    });
    const application = await lockApplication(tx, current.applicationId);
    const entry = await lockEntry(tx, entryId);
    if (!isActiveEntry(entry.status)) return false;
    await tx.entry.update({
      where: { id: entryId },
      data: {
        status: 'WITHDRAWN',
        withdrawnAt: new Date(),
        withdrawnById: userId,
        withdrawReason: reason,
        activeMatchId: null,
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'entry.withdrawn',
      entityType: 'Entry',
      entityId: entryId,
      competitionId: entry.competitionId,
      organizationId: application.organizationId,
      before: { status: entry.status },
      after: { status: 'WITHDRAWN', trigger: 'withdrawn_by_doctor' },
      reason,
    });
    await this.outbox.enqueue(tx, {
      type: 'registration.entry_withdrawn',
      aggregate: { type: 'Entry', id: entryId },
      competitionId: entry.competitionId,
      payload: { entryId },
    });
    return true;
  }
}
