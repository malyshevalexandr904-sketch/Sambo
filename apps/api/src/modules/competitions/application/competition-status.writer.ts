// Запись смены статуса турнира (ARCHITECTURE.md, 16.1): статус, модули-расширения, AuditLog, события перехода —
// в транзакции вызывающего. Общая для команды перехода и автоматических переходов (первая схватка, Phase 7a).
import { Injectable } from '@nestjs/common';
import type { CompetitionStatus } from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { CompetitionExtensions, type TransitionContext } from './competition-extensions';
import { type CompetitionBasics, CompetitionScopeService } from './competition-scope.service';

@Injectable()
export class CompetitionStatusWriter {
  constructor(
    private readonly scopes: CompetitionScopeService,
    private readonly extensions: CompetitionExtensions,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Смена статуса: запись, модули-расширения, аудит, события перехода. */
  async commit(
    ctx: TransitionContext,
    data: Prisma.CompetitionUncheckedUpdateInput,
    after: Record<string, unknown>,
    platformIntervention: boolean,
  ): Promise<void> {
    const { tx, competition } = ctx;
    await tx.competition.update({ where: { id: competition.id }, data });
    await this.extensions.apply(ctx);
    await this.audit.record(tx, {
      action: 'competition.status_changed',
      entityType: 'Competition',
      entityId: competition.id,
      competitionId: competition.id,
      organizationId: competition.organizerOrganizationId,
      before: { status: ctx.from },
      after: { status: ctx.to, ...after },
      reason: ctx.reason,
      platformIntervention,
    });
    await this.events(tx, competition.id, ctx.from, ctx.to);
  }

  /**
   * Первая схватка турнира (план Phase 7a, §1): «Расписание готово → Идут соревнования» без команды пользователя,
   * в транзакции старта схватки. Турнир блокируется FOR UPDATE — вызывающий берёт эту блокировку первой (порядок
   * «турнир → категория → схватка → участие»). Турнир уже идёт — ничего не делает.
   */
  async startOnFirstMatch(tx: Tx, competitionId: string, userId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ status: CompetitionStatus }[]>`
      SELECT status FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    if (row.status !== 'SCHEDULED') return false;
    const competition = (await this.scopes.basics(competitionId)) as CompetitionBasics;
    const ctx: TransitionContext = {
      tx,
      competition,
      from: 'SCHEDULED',
      to: 'IN_PROGRESS',
      reason: null,
      userId,
      now: new Date(),
    };
    const data = { status: 'IN_PROGRESS' as const, version: { increment: 1 }, updatedById: userId };
    await this.commit(ctx, data, { trigger: 'first_match_started' }, false);
    return true;
  }

  private async events(tx: Tx, id: string, from: CompetitionStatus, to: CompetitionStatus): Promise<void> {
    const aggregate = { type: 'Competition', id };
    await this.outbox.enqueue(tx, {
      type: 'competition.status_changed',
      aggregate,
      competitionId: id,
      payload: { competitionId: id, from, to },
    });
    if (to === 'REGISTRATION_OPEN' && from === 'DRAFT')
      await this.outbox.enqueue(tx, {
        type: 'competition.published',
        aggregate,
        competitionId: id,
        payload: { competitionId: id },
      });
  }
}
