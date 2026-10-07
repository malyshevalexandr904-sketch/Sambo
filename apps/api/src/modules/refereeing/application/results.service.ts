// Результат схватки (API.md, 6.3; ARCHITECTURE.md, 14.6, 16.6; план Phase 7a, §3): два шага. Предварительный
// вносит бригада ковра (match.finish, MAT_ASSIGNED) — схватка завершена, участники свободны; исход, отличный от
// предложенного сервером, — с причиной. Подтверждает руководитель ковра этой сессии (MAT_CHIEF) или главный судья
// (result.confirm) — победитель уходит дальше по сетке, снятые участники проигрывают неявкой. Блокировки при
// подтверждении: категория → жеребьёвка → схватка (порядок BracketsService.lockDrawOfMatch).
import { Injectable } from '@nestjs/common';
import {
  determineOutcome,
  type MatchDetailDto,
  type MatchResultInput,
  type ProposedOutcome,
  replayEvents,
} from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { BracketsService } from '../../brackets';
import { CategoryWorkflowService } from '../../categories';
import { entryOn, MatchStoreService } from '../../matches';
import { OutboxService } from '../../outbox';
import { ActiveMatchService } from '../../registrations';
import { WriteLeaseService } from '../../venue-sync';
import { isLive } from '../domain/match-machine';
import { MatchContextService, toScoringEvents } from './match-context.service';
import { MatchQueriesService } from './match-queries.service';
import { WithdrawalsService } from './withdrawals.service';

/** Исход совпадает с предложенным: тот же победитель и способ; «решение судей» — любой победитель способом DECISION. */
function agrees(proposal: ProposedOutcome | null, input: MatchResultInput): boolean {
  if (!proposal) return false;
  if (proposal.winnerSide === null) return input.method === 'DECISION';
  return proposal.winnerSide === input.winnerSide && proposal.method === input.method;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly db: PrismaService,
    private readonly context: MatchContextService,
    private readonly queries: MatchQueriesService,
    private readonly store: MatchStoreService,
    private readonly brackets: BracketsService,
    private readonly categories: CategoryWorkflowService,
    private readonly activeMatch: ActiveMatchService,
    private readonly withdrawals: WithdrawalsService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Предварительный результат и завершение схватки. Повторный ввод до подтверждения заменяет предварительный
   * результат (If-Match: бригада видела последний вариант).
   */
  async record(
    user: AuthUser,
    matchId: string,
    version: number,
    input: MatchResultInput,
  ): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, head.competitionId);
      const m = await this.store.lock(tx, matchId, version);
      const reentry = m.status === 'FINISHED' && m.result?.status === 'PROVISIONAL';
      if (!reentry && !isLive(m.status))
        throw m.status === 'FINISHED'
          ? new DomainError('INVALID_TRANSITION', {
              from: m.result?.status ?? m.status,
              to: 'PROVISIONAL',
              allowed: [],
            })
          : new DomainError('MATCH_NOT_IN_PROGRESS', { status: m.status });
      if (entryOn(m, 'RED') === null || entryOn(m, 'BLUE') === null)
        throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId });
      if (input.expectedSeq !== m.stateSeq)
        throw new DomainError('EXPECTED_SEQ_MISMATCH', {
          expectedSeq: input.expectedSeq,
          currentSeq: m.stateSeq,
        });
      const rules = await this.context.rules(tx, m.competitionId);
      const state = replayEvents(
        toScoringEvents(await this.store.events(tx, matchId)),
        rules,
        (m.durationSeconds ?? 0) * 1000,
      );
      // Итоговый счёт и время — при остановленном секундомере и законченном удержании.
      if (state.clock.running || state.hold)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
          failed: [state.clock.running ? 'clock_running' : 'hold_active'],
        });
      const proposal = determineOutcome(state, rules);
      const accepted = agrees(proposal, input);
      if (!accepted && !input.reason) throw new DomainError('REASON_REQUIRED', { proposed: proposal });
      await this.store.finishProvisional(tx, m, {
        winnerSide: input.winnerSide,
        method: input.method,
        methodDetail: input.methodDetail ?? (accepted ? (proposal?.methodDetail ?? null) : null),
        redScore: state.red.points,
        blueScore: state.blue.points,
        durationMs: state.clock.elapsedMs,
        basedOnSeq: m.stateSeq,
        reason: input.reason ?? null,
        proposedById: user.id,
      });
      await this.activeMatch.release(tx, matchId);
      await this.audit.record(tx, {
        action: reentry ? 'match.result_corrected' : 'match.result_recorded',
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        before: reentry
          ? { winnerSide: m.result?.winnerSide ?? null, method: m.result?.method ?? null }
          : { status: m.status },
        after: {
          status: 'FINISHED',
          result: 'PROVISIONAL',
          winnerSide: input.winnerSide,
          method: input.method,
          score: [state.red.points, state.blue.points],
          proposedAccepted: accepted,
        },
        reason: input.reason ?? null,
      });
    });
    return this.queries.detail(user, matchId);
  }

  /** Подтверждение (руководитель ковра этой сессии или главный судья): продвижение по сетке и утешительным. */
  async confirm(user: AuthUser, matchId: string, version: number): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    await this.db.tx(async (tx) => {
      await this.categories.lockForCommand(tx, head.categoryId);
      const drawId = await this.brackets.lockDrawOfMatch(tx, matchId);
      const m = await this.store.lock(tx, matchId, version);
      if (!m.result) throw new DomainError('MATCH_RESULT_INCOMPLETE', { matchId });
      if (m.status !== 'FINISHED' || m.result.status !== 'PROVISIONAL')
        throw new DomainError('INVALID_TRANSITION', { from: m.result.status, to: 'CONFIRMED', allowed: [] });
      const confirmed = await this.store.confirm(tx, m, user.id);
      if (drawId) {
        await this.brackets.advance(tx, drawId, matchId, m.competitionId);
        await this.withdrawals.resolve(tx, drawId);
      }
      await this.audit.record(tx, {
        action: 'match.result_confirmed',
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        before: { result: 'PROVISIONAL' },
        after: { result: 'CONFIRMED', winnerSide: confirmed.winnerSide, method: m.result.method },
      });
      await this.outbox.enqueue(tx, {
        type: 'match.result_confirmed',
        aggregate: { type: 'Match', id: matchId },
        competitionId: m.competitionId,
        payload: {
          matchId,
          categoryId: m.categoryId,
          winnerSide: confirmed.winnerSide,
          method: m.result.method,
        },
      });
    });
    return this.queries.detail(user, matchId);
  }
}
