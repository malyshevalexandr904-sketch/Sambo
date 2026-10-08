// Изменение подтверждённого результата (план Phase 7b, §2; `result.amend` — главный судья): прежний вариант — в
// прежние варианты (только дополняются), результат → AMENDED, аудит «было → стало». Победитель изменился — сетка
// пересчитывается: зависимые схватки, проведённые людьми, менять нельзя (DEPENDENT_MATCHES_STARTED со списком),
// исходы системы пересчитываются; места категории — заново (у опубликованной — AMENDED и история спортсменов).
// Блокировки — как у подтверждения: категория → жеребьёвка → схватка.
import { Injectable } from '@nestjs/common';
import type { MatchDetailDto, MatchResultAmend } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { BracketsService } from '../../brackets';
import { CategoryWorkflowService } from '../../categories';
import { entryOn, isConfirmed, type MatchRecord, MatchStoreService } from '../../matches';
import { OutboxService } from '../../outbox';
import { CategoryResultsService } from '../../results';
import { MatchContextService } from './match-context.service';
import { MatchQueriesService } from './match-queries.service';
import { WithdrawalsService } from './withdrawals.service';

/** Изменить можно подтверждённый результат сыгранной схватки (исход «без соперника» — нет: схватки не было). */
function assertAmendable(m: MatchRecord): NonNullable<MatchRecord['result']> {
  const r = m.result;
  if (!r || m.status !== 'FINISHED' || !isConfirmed(m))
    throw new DomainError('INVALID_TRANSITION', { from: r?.status ?? m.status, to: 'AMENDED', allowed: [] });
  if (entryOn(m, 'RED') === null || entryOn(m, 'BLUE') === null)
    throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId: m.id });
  return r;
}

@Injectable()
export class AmendService {
  constructor(
    private readonly db: PrismaService,
    private readonly context: MatchContextService,
    private readonly queries: MatchQueriesService,
    private readonly store: MatchStoreService,
    private readonly brackets: BracketsService,
    private readonly categories: CategoryWorkflowService,
    private readonly withdrawals: WithdrawalsService,
    private readonly results: CategoryResultsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async amend(
    user: AuthUser,
    matchId: string,
    version: number,
    input: MatchResultAmend,
  ): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    await this.db.tx(async (tx) => {
      const locked = await this.categories.lockForCommand(tx, head.categoryId);
      const drawId = await this.brackets.lockDrawOfMatch(tx, matchId);
      const m = await this.store.lock(tx, matchId, version);
      const r = assertAmendable(m);
      const before = {
        revision: r.revision,
        winnerSide: r.winnerSide,
        method: r.method,
        methodDetail: r.methodDetail,
        score: [r.redScore, r.blueScore],
      };
      const next = {
        winnerSide: input.winnerSide,
        method: input.method,
        methodDetail: input.methodDetail ?? null,
        redScore: input.redScore ?? r.redScore,
        blueScore: input.blueScore ?? r.blueScore,
        reason: input.reason,
        changedById: user.id,
      };
      await this.store.amend(tx, m, next);
      if (drawId) {
        await this.brackets.propagateAfterAmend(tx, drawId);
        await this.withdrawals.resolve(tx, drawId);
        await this.results.refresh(tx, locked, drawId);
      }
      const winnerChanged = r.winnerSide !== input.winnerSide;
      await this.audit.record(tx, {
        action: 'match.result_amended',
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        before,
        after: {
          revision: r.revision + 1,
          winnerSide: next.winnerSide,
          method: next.method,
          methodDetail: next.methodDetail,
          score: [next.redScore, next.blueScore],
        },
        reason: input.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'match.result_amended',
        aggregate: { type: 'Match', id: matchId },
        competitionId: m.competitionId,
        payload: { matchId, categoryId: m.categoryId, revision: r.revision + 1, winnerChanged },
      });
    });
    return this.queries.detail(user, matchId);
  }
}
