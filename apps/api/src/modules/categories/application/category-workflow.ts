// Категория турнира в командах других модулей (жеребьёвка — Phase 5a, схватки — Phase 7): область прав по
// категории, блокировки в порядке «турнир → категория» и системные переходы машины состояний категории
// (READY_FOR_DRAW ⇄ DRAWN), которые выполняет не команда transitions, а публикация или замена жеребьёвки.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { CategoryStatus, CompetitionStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ScopeResolverRegistry } from '../../access';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { findCategoryTransition } from '../domain/category-machine';
import { CategoryExtensions } from './category-extensions';
import { blocked, lockCategory, lockCompetitionShared } from './category-locks';
import type { CategoryRow } from './category-mapper';

export interface LockedCategory {
  competitionStatus: CompetitionStatus;
  /** Актуальная строка категории: системный переход обновляет её на месте. */
  category: CategoryRow;
}

@Injectable()
export class CategoryWorkflowService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly registry: ScopeResolverRegistry,
    private readonly competitions: CompetitionScopeService,
    private readonly extensions: CategoryExtensions,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.registry.register('competitionCategory', async (id) =>
      this.competitions.scopeOf((await this.require(id)).competitionId),
    );
  }

  /** Категория турнира (не удалённого); чужая или несуществующая — 404. */
  async require(categoryId: string | undefined, tx?: Tx): Promise<CategoryRow> {
    const row = categoryId
      ? await (tx ?? this.db).competitionCategory.findFirst({
          where: { id: categoryId, competition: { deletedAt: null } },
        })
      : null;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'category' });
    return row;
  }

  /** Право записи турнира, турнир FOR SHARE (его переход ждёт команду), категория FOR UPDATE. */
  async lockForCommand(tx: Tx, categoryId: string): Promise<LockedCategory> {
    const { competitionId } = await this.require(categoryId, tx);
    await this.leases.assertWritable(tx, competitionId);
    const competitionStatus = await lockCompetitionShared(tx, competitionId);
    return { competitionStatus, category: await lockCategory(tx, competitionId, categoryId) };
  }

  /**
   * Системный переход категории (ARCHITECTURE.md, 16.2): только разрешённый машиной и статусом турнира, с проверками
   * модулей, аудитом и событием. Вызывается под блокировкой lockForCommand.
   */
  async systemTransition(
    tx: Tx,
    locked: LockedCategory,
    to: CategoryStatus,
    reason: string | null = null,
  ): Promise<void> {
    const row = locked.category;
    const def = findCategoryTransition(row.status, to);
    if (!def) throw new DomainError('INVALID_TRANSITION', { from: row.status, to, allowed: [] });
    if (!def.competition.includes(locked.competitionStatus)) throw blocked('competition_status');
    const failed = await this.extensions.check({
      tx,
      competitionId: row.competitionId,
      categoryId: row.id,
      from: row.status,
      to,
    });
    if (failed.length > 0) throw blocked(...failed);
    await tx.competitionCategory.update({
      where: { id: row.id },
      data: { status: to, version: { increment: 1 } },
    });
    // Блокировка держит актуальную строку: следующий переход в той же транзакции идёт от нового статуса
    // (DRAWN → IN_PROGRESS → COMPLETED, Phase 7b).
    locked.category = { ...row, status: to, version: row.version + 1 };
    await this.audit.record(tx, {
      action: 'category.status_changed',
      entityType: 'CompetitionCategory',
      entityId: row.id,
      competitionId: row.competitionId,
      before: { status: row.status },
      after: { status: to },
      reason,
    });
    await this.outbox.enqueue(tx, {
      type: 'category.status_changed',
      aggregate: { type: 'CompetitionCategory', id: row.id },
      competitionId: row.competitionId,
      payload: { categoryId: row.id, from: row.status, to },
    });
  }
}
