// Врач на ковре (G-05, часть 2; план Phase 7b, §3; `medical.record` — врач турнира): помощь (схватка продолжается)
// или остановка; снятие врачом — при остановленном времени и без удержания (как запись результата): предварительный
// результат «травма» (победитель — соперник), участники свободны; в схватке сетки спортсмен снят с турнира (участие в
// этой категории), его оставшиеся схватки — неявкой автоматически; ручная схватка вне сетки участие не снимает. Без
// диагнозов; заметку видит только медицинский персонал, её чтение — в журнал доступа. Блокировки: категория (снятие
// участия требует её первой) → схватка → заявка → участие.
import { Injectable } from '@nestjs/common';
import {
  clockNowMs,
  type MatchDetailDto,
  type MedicalIncidentCreate,
  type MatchState,
  type MedicalIncidentDto,
  replayEvents,
  type Side,
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService, DataAccessLogService } from '../../audit';
import { CategoryWorkflowService } from '../../categories';
import { entryOn, type MatchRecord, MatchStoreService } from '../../matches';
import { OutboxService } from '../../outbox';
import { ActiveMatchService, EntryWithdrawalService } from '../../registrations';
import { isLive } from '../domain/match-machine';
import { MatchContextService, toScoringEvents } from './match-context.service';
import { incidentDto } from './match-mapper';
import { MatchQueriesService } from './match-queries.service';

const other = (side: Side): Side => (side === 'RED' ? 'BLUE' : 'RED');

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

@Injectable()
export class MedicalIncidentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly context: MatchContextService,
    private readonly queries: MatchQueriesService,
    private readonly store: MatchStoreService,
    private readonly categories: CategoryWorkflowService,
    private readonly activeMatch: ActiveMatchService,
    private readonly withdrawals: EntryWithdrawalService,
    private readonly audit: AuditService,
    private readonly accessLog: DataAccessLogService,
    private readonly outbox: OutboxService,
  ) {}

  async record(user: AuthUser, matchId: string, input: MedicalIncidentCreate): Promise<MatchDetailDto> {
    const head = await this.context.head(matchId);
    const access = await this.policy.assert(
      user,
      'medical.record',
      await this.context.scopeOf(head.competitionId),
    );
    await this.db.tx(async (tx) => {
      await this.categories.lockForCommand(tx, head.categoryId);
      const m = await this.store.lock(tx, matchId);
      if (!isLive(m.status)) throw new DomainError('MATCH_NOT_IN_PROGRESS', { status: m.status });
      const entryId = entryOn(m, input.side);
      if (!entryId || entryOn(m, other(input.side)) === null)
        throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId });
      const rules = await this.context.rules(tx, m.competitionId);
      const state = replayEvents(
        toScoringEvents(await this.store.events(tx, matchId)),
        rules,
        (m.durationSeconds ?? 0) * 1000,
      );
      const clockMs = input.matchClockMs ?? clockNowMs(state.clock, Date.now(), state.durationMs);
      const withdrawn = input.decision === 'WITHDRAWN_BY_DOCTOR';
      // Снятие завершает схватку: сначала «Стоп» на планшете (как перед записью результата).
      if (withdrawn && state.clock.running) throw blocked('clock_running');
      if (withdrawn && state.hold) throw blocked('hold_active');
      await tx.medicalIncident.create({
        data: {
          id: uuidv7(),
          competitionId: m.competitionId,
          matchId,
          entryId,
          side: input.side,
          kind: input.kind,
          decision: input.decision,
          matchClockMs: clockMs,
          note: input.note?.trim() || null,
          recordedById: user.id,
        },
      });
      if (withdrawn)
        await this.withdrawByDoctor(tx, m, { side: input.side, entryId, state, clockMs, userId: user.id });
      await this.audit.record(tx, {
        action: 'medical.incident_recorded',
        entityType: 'Match',
        entityId: matchId,
        competitionId: m.competitionId,
        after: { side: input.side, kind: input.kind, decision: input.decision, clockMs },
        platformIntervention: access.viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'medical.incident_recorded',
        aggregate: { type: 'Match', id: matchId },
        competitionId: m.competitionId,
        payload: { matchId, entryId, withdrawn },
      });
    });
    return this.queries.detail(user, matchId);
  }

  /**
   * Снятие врачом — исход схватки «травма» (предварительный, подтверждение — как обычно): победитель — соперник,
   * участники свободны; в схватке сетки участие снято (оставшиеся схватки — неявкой автоматически).
   */
  private async withdrawByDoctor(
    tx: Tx,
    m: MatchRecord,
    at: { side: Side; entryId: string; state: MatchState; clockMs: number; userId: string },
  ): Promise<void> {
    await this.store.finishProvisional(tx, m, {
      winnerSide: other(at.side),
      method: 'INJURY',
      methodDetail: 'WITHDRAWN_BY_DOCTOR',
      redScore: at.state.red.points,
      blueScore: at.state.blue.points,
      durationMs: at.clockMs,
      basedOnSeq: m.stateSeq,
      reason: 'withdrawn_by_doctor',
      proposedById: at.userId,
    });
    await this.activeMatch.release(tx, m.id);
    // Ручная схватка вне сетки (показательная, переигровка) на места не влияет — участие в категории не снимается.
    if (m.bracketNodeId !== null)
      await this.withdrawals.withdrawBySystem(tx, at.entryId, at.userId, 'withdrawn_by_doctor');
  }

  /** Записи врача по схватке с заметками — медицинскому персоналу (`medical.view`); чтение — в журнал доступа. */
  async list(user: AuthUser, matchId: string): Promise<MedicalIncidentDto[]> {
    const head = await this.context.head(matchId);
    const scope = await this.context.scopeOf(head.competitionId);
    await this.policy.assert(user, 'medical.view', scope);
    const rows = await this.store.incidents(null, [matchId]);
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    for (const r of rows) await this.accessLog.record('VIEW', 'MedicalIncident', r.id, head.competitionId);
    return rows.map((r) => incidentDto(r, names, r.note));
  }
}
