// Журнал событий схватки (API.md, 6.3; ARCHITECTURE.md, 14.6; план Phase 7a, §2): оценки, удержание, наказания,
// показания секундомера, отмена события компенсирующим событием. Счёт — чистая функция журнала и правил турнира
// (packages/contracts/scoring.ts). Защита от дублей и гонок: ключ идемпотентности (повтор возвращает уже
// записанное событие) и expectedSeq (команда по устаревшему состоянию — EXPECTED_SEQ_MISMATCH). Право проверяет
// маршрут: scoring.create / scoring.update, судье — на ковре схватки в её сессии (MAT_ASSIGNED).
import { Injectable } from '@nestjs/common';
import {
  applyEvent,
  clockNowMs,
  determineOutcome,
  initialMatchState,
  type MatchEventCreate,
  type MatchEventResultDto,
  type MatchEventVoid,
  type MatchState,
  replayEvents,
  type RuleSetParametersV1,
  type ScoringEvent,
  type Side,
  voidRejection,
} from '@sde/contracts';
import { type MatchEvent, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type EventWrite, type MatchRecord, MatchStoreService } from '../../matches';
import { WriteLeaseService } from '../../venue-sync';
import { MatchContextService, toScoringEvents } from './match-context.service';
import { eventDto, stateOf } from './match-mapper';

interface Prepared {
  m: MatchRecord;
  rules: RuleSetParametersV1;
  events: MatchEvent[];
  state: MatchState;
}

type Outcome = { repeated: MatchEvent; m: MatchRecord } | Prepared;

const lastPenalty = (s: MatchState, side: Side): string | null =>
  (side === 'RED' ? s.red : s.blue).penalties.at(-1) ?? null;

@Injectable()
export class ScoringService {
  constructor(
    private readonly db: PrismaService,
    private readonly context: MatchContextService,
    private readonly store: MatchStoreService,
    private readonly leases: WriteLeaseService,
  ) {}

  /**
   * Общее начало записи: право записи турнира, схватка FOR UPDATE, повтор по ключу, схватка идёт, номер последнего
   * события совпадает с expectedSeq, счёт по журналу.
   */
  private async prepare(tx: Tx, matchId: string, key: string, expectedSeq: number): Promise<Outcome> {
    const head = await this.context.head(matchId, tx);
    await this.leases.assertWritable(tx, head.competitionId);
    const m = await this.store.lock(tx, matchId);
    const repeated = await this.store.eventByKey(tx, matchId, key);
    if (repeated) return { repeated, m };
    if (m.status !== 'IN_PROGRESS') throw new DomainError('MATCH_NOT_IN_PROGRESS', { status: m.status });
    if (expectedSeq !== m.stateSeq)
      throw new DomainError('EXPECTED_SEQ_MISMATCH', { expectedSeq, currentSeq: m.stateSeq });
    const rules = await this.context.rules(tx, m.competitionId);
    const events = await this.store.events(tx, matchId);
    const state = replayEvents(toScoringEvents(events), rules, (m.durationSeconds ?? 0) * 1000);
    return { m, rules, events, state };
  }

  private async respond(
    event: MatchEvent,
    state: MatchState | null,
    seq: number,
    rules: RuleSetParametersV1,
  ): Promise<MatchEventResultDto> {
    const recorder = event.recordedById
      ? await this.db.user.findUnique({ where: { id: event.recordedById }, select: { displayName: true } })
      : null;
    const names = new Map(event.recordedById ? [[event.recordedById, recorder?.displayName ?? '']] : []);
    return {
      event: eventDto(event, new Set(), names),
      seq,
      state: state ?? initialMatchState(0),
      proposedOutcome: state ? determineOutcome(state, rules) : null,
    };
  }

  /** Повтор команды с тем же ключом: уже записанное событие и текущий счёт, без нового события. */
  private async repeat(o: { repeated: MatchEvent; m: MatchRecord }): Promise<MatchEventResultDto> {
    const rules = await this.context.rules(this.db, o.m.competitionId);
    return this.respond(o.repeated, stateOf(o.m.state), o.m.stateSeq, rules);
  }

  async record(
    user: AuthUser,
    matchId: string,
    idempotencyKey: string,
    input: MatchEventCreate,
  ): Promise<MatchEventResultDto> {
    const done = await this.db.tx(async (tx) => {
      const p = await this.prepare(tx, matchId, idempotencyKey, input.expectedSeq);
      if ('repeated' in p) return p;
      const id = uuidv7();
      const candidate: ScoringEvent = {
        id,
        seq: p.m.stateSeq + 1,
        type: input.type,
        side: input.side ?? null,
        actionCode: input.actionCode ?? null,
        value: input.value ?? null,
        matchClockMs: input.matchClockMs,
        deviceTime: input.deviceTime,
        voidsEventId: null,
      };
      const r = applyEvent(p.state, candidate, p.rules);
      if (!r.ok) throw new DomainError('EVENT_NOT_ALLOWED_BY_RULESET', { reason: r.reason });
      const write: EventWrite = {
        id,
        type: input.type,
        side: input.side ?? null,
        // Наказание записывается кодом, выданным по порядку правил (планшет мог не передать код).
        actionCode:
          input.type === 'PENALTY' && input.side
            ? lastPenalty(r.state, input.side)
            : (input.actionCode ?? null),
        value: input.value ?? null,
        matchClockMs: input.matchClockMs,
        deviceTime: new Date(input.deviceTime),
        voidsEventId: null,
        idempotencyKey,
        recordedById: user.id,
        deviceId: input.deviceId ?? null,
        payload: null,
      };
      const event = await this.store.appendEvent(tx, p.m, write, r.state);
      return { event, state: { ...r.state, seq: event.seq }, rules: p.rules };
    });
    if ('repeated' in done) return this.repeat(done);
    return this.respond(done.event, done.state, done.event.seq, done.rules);
  }

  /**
   * Отмена события (кнопка «Отменить последнее»): компенсирующее событие EVENT_VOIDED; исходное остаётся в журнале,
   * счёт пересчитывается без него. Отменить можно оценку, наказание, удержание (целиком) — не показания времени.
   */
  async voidEvent(
    user: AuthUser,
    matchId: string,
    eventId: string,
    idempotencyKey: string,
    input: MatchEventVoid,
  ): Promise<MatchEventResultDto> {
    const done = await this.db.tx(async (tx) => {
      const p = await this.prepare(tx, matchId, idempotencyKey, input.expectedSeq);
      if ('repeated' in p) return p;
      const log = toScoringEvents(p.events);
      const rejection = voidRejection(log, eventId);
      if (rejection) throw new DomainError('EVENT_NOT_ALLOWED_BY_RULESET', { reason: rejection });
      const id = uuidv7();
      const now = new Date();
      const clockMs = input.matchClockMs ?? clockNowMs(p.state.clock, now.getTime(), p.state.durationMs);
      const deviceTime = input.deviceTime ?? now.toISOString();
      const voiding: ScoringEvent = {
        id,
        seq: p.m.stateSeq + 1,
        type: 'EVENT_VOIDED',
        side: null,
        actionCode: null,
        value: null,
        matchClockMs: clockMs,
        deviceTime,
        voidsEventId: eventId,
      };
      const state = replayEvents([...log, voiding], p.rules, p.state.durationMs);
      const event = await this.store.appendEvent(
        tx,
        p.m,
        {
          id,
          type: 'EVENT_VOIDED',
          side: null,
          actionCode: null,
          value: null,
          matchClockMs: clockMs,
          deviceTime: new Date(deviceTime),
          voidsEventId: eventId,
          idempotencyKey,
          recordedById: user.id,
          deviceId: input.deviceId ?? null,
          payload: input.reason ? { reason: input.reason } : null,
        },
        state,
      );
      return { event, state, rules: p.rules };
    });
    if ('repeated' in done) return this.repeat(done);
    return this.respond(done.event, done.state, done.event.seq, done.rules);
  }
}
