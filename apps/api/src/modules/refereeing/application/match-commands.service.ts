// Переходы схватки и неявка (API.md, 6.3; ARCHITECTURE.md, 16.6; план Phase 7a, §1, §3): вызов пары и его отмена,
// старт (оба участника «на ковре» условным обновлением; первая схватка турнира и категории переводит их статусы),
// длинная остановка и продолжение, неявка по вызову. Право — по переходу (match.update / match.start /
// match.finish), судье — только на ковре схватки в её сессии (MAT_ASSIGNED). Порядок блокировок: турнир →
// категория → схватка → участие (ARCHITECTURE.md, 10).
import { Injectable } from '@nestjs/common';
import {
  type AuditAction,
  initialMatchState,
  type MatchDetailDto,
  type MatchNoShowRequest,
  type MatchTransitionRequest,
  type Side,
} from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CategoryWorkflowService } from '../../categories';
import { CompetitionStatusWriter } from '../../competitions';
import { entryOn, type MatchRecord, MatchStoreService } from '../../matches';
import { OutboxService } from '../../outbox';
import { ActiveMatchService } from '../../registrations';
import { WriteLeaseService } from '../../venue-sync';
import { findMatchTransition, matchTransitionsFrom, noShowAllowed } from '../domain/match-machine';
import { MatchContextService } from './match-context.service';
import { MatchQueriesService } from './match-queries.service';
import { stateOf } from './match-mapper';

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

/** Действие аудита перехода: вызов, отмена вызова, старт, пауза, продолжение. */
function auditAction(from: MatchRecord['status'], to: MatchTransitionRequest['to']): AuditAction {
  if (to === 'READY') return 'match.called';
  if (to === 'SCHEDULED') return 'match.call_cancelled';
  if (to === 'PAUSED') return 'match.paused';
  return from === 'PAUSED' ? 'match.resumed' : 'match.started';
}

/** Схватки проводятся, когда расписание готово или турнир уже идёт. */
const OPERATING = ['SCHEDULED', 'IN_PROGRESS'];

@Injectable()
export class MatchCommandsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly context: MatchContextService,
    private readonly queries: MatchQueriesService,
    private readonly store: MatchStoreService,
    private readonly competitionStatus: CompetitionStatusWriter,
    private readonly categories: CategoryWorkflowService,
    private readonly activeMatch: ActiveMatchService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private invalid(from: MatchRecord['status'], to: string): DomainError {
    return new DomainError('INVALID_TRANSITION', {
      from,
      to,
      allowed: matchTransitionsFrom(from).map((t) => t.to),
    });
  }

  async transition(
    user: AuthUser,
    matchId: string,
    version: number,
    req: MatchTransitionRequest,
  ): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    const def = findMatchTransition(head.status, req.to);
    if (!def) throw this.invalid(head.status, req.to);
    const scope = await this.context.scopeOf(head.competitionId);
    const access = await this.policy.assert(user, def.permission, scope, { matchId });
    // Завершение — только с предварительным результатом: его вносит команда result вместе с завершением.
    if (req.to === 'FINISHED') throw new DomainError('MATCH_RESULT_INCOMPLETE', { matchId });
    const starting = head.status === 'READY' && req.to === 'IN_PROGRESS';
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, head.competitionId);
      if (starting) {
        // Первая схватка турнира переводит его в «Идут соревнования»: блокировка турнира — первой.
        const status = await tx.competition.findUnique({
          where: { id: head.competitionId },
          select: { status: true },
        });
        if (status?.status === 'SCHEDULED')
          await this.competitionStatus.startOnFirstMatch(tx, head.competitionId, user.id);
      }
      const locked = starting ? await this.categories.lockForCommand(tx, head.categoryId) : null;
      const m = await this.store.lock(tx, matchId, version);
      if (m.status !== head.status || !findMatchTransition(m.status, req.to))
        throw this.invalid(m.status, req.to);
      const before = m.status;
      if (req.to === 'READY') await this.call(tx, m);
      else if (req.to === 'SCHEDULED') await this.store.cancelReady(tx, m);
      else if (req.to === 'PAUSED') await this.pause(tx, m);
      else if (before === 'PAUSED') await this.store.setPaused(tx, m, false);
      else if (locked) {
        await this.start(tx, m);
        if (locked.category.status === 'DRAWN')
          await this.categories.systemTransition(tx, locked, 'IN_PROGRESS');
      }
      await this.audit.record(tx, {
        action: auditAction(before, req.to),
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        before: { status: before },
        after: { status: req.to },
        reason: req.reason ?? null,
        platformIntervention: access.viaPlatform,
      });
    });
    return this.queries.detail(user, matchId);
  }

  /** Схватки проводятся только при готовом расписании или идущем турнире. */
  private async assertOperating(tx: Tx, competitionId: string): Promise<void> {
    const c = await tx.competition.findUnique({ where: { id: competitionId }, select: { status: true } });
    if (!c || !OPERATING.includes(c.status)) throw blocked('competition_status');
  }

  /**
   * Оба участника известны, одобрены, допущены и не заняты в другой схватке; у схватки есть место в расписании
   * (план §1). Для старта — то же; занятость при старте проверяет условное обновление участий.
   */
  private async assertParticipantsReady(tx: Tx, m: MatchRecord): Promise<string[]> {
    await this.assertOperating(tx, m.competitionId);
    const entryIds = [entryOn(m, 'RED'), entryOn(m, 'BLUE')];
    if (entryIds.some((id) => id === null))
      throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId: m.id });
    const slot = await tx.matchSchedule.findUnique({ where: { matchId: m.id }, select: { matId: true } });
    if (!slot) throw blocked('not_scheduled');
    const readiness = await this.activeMatch.readiness(tx, entryIds as string[]);
    if (readiness.some((r) => r.status !== 'APPROVED')) throw blocked('participant_withdrawn');
    if (readiness.some((r) => r.admission !== 'ADMITTED')) throw blocked('not_admitted');
    const busy = readiness.find((r) => r.activeMatchId !== null && r.activeMatchId !== m.id);
    if (busy)
      throw new DomainError('ATHLETE_IN_ACTIVE_MATCH', {
        entryId: busy.entryId,
        matchId: busy.activeMatchId,
      });
    return entryIds as string[];
  }

  private async call(tx: Tx, m: MatchRecord): Promise<void> {
    await this.assertParticipantsReady(tx, m);
    await this.store.markReady(tx, m);
  }

  private async start(tx: Tx, m: MatchRecord): Promise<void> {
    const entryIds = await this.assertParticipantsReady(tx, m);
    if (!m.durationSeconds) throw blocked('duration_unknown');
    const slot = await tx.matchSchedule.findUniqueOrThrow({
      where: { matchId: m.id },
      select: { matId: true },
    });
    await this.activeMatch.claim(tx, m.id, entryIds);
    await this.store.markStarted(tx, m, slot.matId, initialMatchState(m.durationSeconds * 1000));
    await this.outbox.enqueue(tx, {
      type: 'match.started',
      aggregate: { type: 'Match', id: m.id },
      competitionId: m.competitionId,
      payload: { matchId: m.id, categoryId: m.categoryId },
    });
  }

  /** Длинная остановка — при остановленном секундомере и без идущего удержания. */
  private async pause(tx: Tx, m: MatchRecord): Promise<void> {
    const state = stateOf(m.state);
    if (state?.clock.running) throw blocked('clock_running');
    if (state?.hold) throw blocked('hold_active');
    await this.store.setPaused(tx, m, true);
  }

  /**
   * Неявка по вызову (план §3): предварительный результат NO_SHOW — победитель соперник, не явились оба — оба
   * проигравшие; схватка завершается и ждёт подтверждения, как любой результат.
   */
  async noShow(
    user: AuthUser,
    matchId: string,
    version: number,
    req: MatchNoShowRequest,
  ): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, head.competitionId);
      const m = await this.store.lock(tx, matchId, version);
      if (!noShowAllowed(m.status)) throw this.invalid(m.status, 'FINISHED');
      await this.assertOperating(tx, m.competitionId);
      const red = entryOn(m, 'RED');
      const blue = entryOn(m, 'BLUE');
      if (red === null || blue === null) throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId });
      // Не явился тот, кто сейчас борется на другом ковре, — не неявка: схватку ждут.
      const absent = req.side === 'BOTH' ? [red, blue] : [req.side === 'RED' ? red : blue];
      const busy = (await this.activeMatch.readiness(tx, absent)).find(
        (r) => r.activeMatchId !== null && r.activeMatchId !== m.id,
      );
      if (busy)
        throw new DomainError('ATHLETE_IN_ACTIVE_MATCH', {
          entryId: busy.entryId,
          matchId: busy.activeMatchId,
        });
      const winnerSide: Side | null = req.side === 'BOTH' ? null : req.side === 'RED' ? 'BLUE' : 'RED';
      await this.store.finishProvisional(tx, m, {
        winnerSide,
        method: 'NO_SHOW',
        methodDetail: req.side === 'BOTH' ? 'BOTH' : null,
        redScore: null,
        blueScore: null,
        durationMs: null,
        basedOnSeq: m.stateSeq,
        reason: req.reason ?? null,
        proposedById: user.id,
      });
      await this.audit.record(tx, {
        action: 'match.no_show',
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        before: { status: m.status },
        after: { status: 'FINISHED', result: 'PROVISIONAL', method: 'NO_SHOW', absent: req.side },
        reason: req.reason ?? null,
      });
    });
    return this.queries.detail(user, matchId);
  }
}
