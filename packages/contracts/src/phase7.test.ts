import { describe, expect, it } from 'vitest';
import { MatchEventCreate, MatchNoShowRequest, MatchResultInput } from './matches.js';
import { SAMPLE_RULESET_PARAMETERS } from './rulesets.js';
import {
  applyEvent,
  clockNowMs,
  determineOutcome,
  holdPoints,
  initialMatchState,
  lastVoidableEvent,
  type MatchState,
  replayEvents,
  type ScoringEvent,
  voidRejection,
} from './scoring.js';

const RULES = SAMPLE_RULESET_PARAMETERS;
const DURATION = 180_000;
const T0 = Date.parse('2026-11-14T07:00:00.000Z');

/** Журнал схватки: события по порядку, время устройства — от T0 по показанию секундомера. */
class Log {
  events: ScoringEvent[] = [];
  private add(e: Partial<ScoringEvent> & Pick<ScoringEvent, 'type'>): ScoringEvent {
    const seq = this.events.length + 1;
    const clock = e.matchClockMs ?? 0;
    const event: ScoringEvent = {
      id: `e${seq}`,
      seq,
      side: null,
      actionCode: null,
      value: null,
      deviceTime: new Date(T0 + clock).toISOString(),
      voidsEventId: null,
      matchClockMs: clock,
      ...e,
    };
    this.events.push(event);
    return event;
  }
  start(ms = 0) {
    return this.add({ type: 'CLOCK_STARTED', matchClockMs: ms });
  }
  stop(ms: number) {
    return this.add({ type: 'CLOCK_STOPPED', matchClockMs: ms });
  }
  score(side: 'RED' | 'BLUE', code: string, ms = 1000) {
    return this.add({ type: 'SCORE', side, actionCode: code, matchClockMs: ms });
  }
  penalty(side: 'RED' | 'BLUE', ms = 1000) {
    return this.add({ type: 'PENALTY', side, matchClockMs: ms });
  }
  hold(side: 'RED' | 'BLUE', holdMs: number, ms = 1000) {
    this.add({ type: 'HOLD_STARTED', side, matchClockMs: ms });
    return this.add({ type: 'HOLD_ENDED', side, value: holdMs, matchClockMs: ms + holdMs });
  }
  void(target: ScoringEvent) {
    return this.add({ type: 'EVENT_VOIDED', voidsEventId: target.id });
  }
  state(): MatchState {
    return replayEvents(this.events, RULES, DURATION);
  }
}

describe('scoring: points come from the rules', () => {
  it('adds throw points and keeps the technical scores by value', () => {
    const log = new Log();
    log.start();
    log.score('RED', 'THROW_4');
    log.score('BLUE', 'THROW_2');
    log.score('RED', 'THROW_1');
    const s = log.state();
    expect([s.red.points, s.blue.points]).toEqual([5, 2]);
    expect(s.red.technical).toEqual({ '4': 1, '1': 1 });
    expect(s.lastTechnical).toBe('RED');
    expect(s.seq).toBe(4);
  });

  it('gives a total victory for a throw or a submission from the rules', () => {
    const log = new Log();
    log.start();
    log.score('BLUE', 'SUBMISSION');
    expect(determineOutcome(log.state(), RULES)).toEqual({
      winnerSide: 'BLUE',
      method: 'TOTAL_VICTORY',
      methodDetail: 'SUBMISSION',
      basis: 'TOTAL_VICTORY',
    });
  });

  it('ends the match early on superiority and refuses further scoring', () => {
    const log = new Log();
    log.start();
    log.score('RED', 'THROW_4');
    log.score('RED', 'THROW_4');
    const s = log.state();
    expect(s.decision).toEqual({ kind: 'SUPERIORITY', winner: 'RED', detail: null });
    const r = applyEvent(s, { ...log.events[1]!, id: 'x', seq: 4 }, RULES);
    expect(r).toEqual({ ok: false, reason: 'match_decided' });
  });

  it('rejects actions that are not in the rules', () => {
    const r = applyEvent(
      initialMatchState(DURATION),
      {
        id: 'x',
        seq: 1,
        type: 'SCORE',
        side: 'RED',
        actionCode: 'THROW_3',
        value: null,
        matchClockMs: 0,
        deviceTime: new Date(T0).toISOString(),
        voidsEventId: null,
      },
      RULES,
    );
    expect(r).toEqual({ ok: false, reason: 'unknown_action' });
  });
});

describe('scoring: penalties go in order', () => {
  it('remark, warning (1 point), second warning (2 points), disqualification', () => {
    const log = new Log();
    log.start();
    log.penalty('RED');
    log.penalty('RED');
    let s = log.state();
    expect(s.red.penalties).toEqual(['REMARK', 'WARNING_1']);
    expect(s.blue.points).toBe(1);
    log.penalty('RED');
    s = log.state();
    expect(s.blue.points).toBe(3);
    log.penalty('RED');
    s = log.state();
    expect(s.decision).toEqual({ kind: 'DISQUALIFICATION', winner: 'BLUE', detail: 'DISQUALIFICATION' });
    expect(determineOutcome(s, RULES)?.method).toBe('DISQUALIFICATION');
  });

  it('refuses a penalty code that is not the next one in order', () => {
    const r = applyEvent(
      initialMatchState(DURATION),
      {
        id: 'x',
        seq: 1,
        type: 'PENALTY',
        side: 'BLUE',
        actionCode: 'WARNING_1',
        value: null,
        matchClockMs: 0,
        deviceTime: new Date(T0).toISOString(),
        voidsEventId: null,
      },
      RULES,
    );
    expect(r).toEqual({ ok: false, reason: 'penalty_out_of_order' });
  });
});

describe('scoring: holds', () => {
  it('scores by the thresholds of the rules', () => {
    expect([5_000, 10_000, 19_999, 20_000, 25_000].map((ms) => holdPoints(RULES, ms))).toEqual([
      0, 2, 2, 4, 4,
    ]);
    const log = new Log();
    log.start();
    log.hold('BLUE', 20_000);
    expect(log.state().blue).toMatchObject({ points: 4, holds: 1 });
  });

  it('counts only one scored hold per athlete per match (maxPerMatch)', () => {
    const log = new Log();
    log.start();
    log.hold('RED', 12_000, 1000);
    const s = log.state();
    const r = applyEvent(
      s,
      {
        id: 'x',
        seq: 9,
        type: 'HOLD_STARTED',
        side: 'RED',
        actionCode: null,
        value: null,
        matchClockMs: 40_000,
        deviceTime: new Date(T0 + 40_000).toISOString(),
        voidsEventId: null,
      },
      RULES,
    );
    expect(r).toEqual({ ok: false, reason: 'hold_limit_reached' });
    // Удержание без оценки лимит не расходует, соперник — свой лимит.
    const log2 = new Log();
    log2.start();
    log2.hold('BLUE', 4000, 1000);
    log2.hold('BLUE', 10_000, 20_000);
    expect(log2.state().blue).toMatchObject({ points: 2, holds: 1 });
  });

  it('finishes a hold that started before the time ran out', () => {
    const log = new Log();
    log.start();
    log.score('BLUE', 'THROW_2');
    const started = applyEvent(
      log.state(),
      {
        id: 'h1',
        seq: 3,
        type: 'HOLD_STARTED',
        side: 'RED',
        actionCode: null,
        value: null,
        matchClockMs: 175_000,
        deviceTime: new Date(T0 + 175_000).toISOString(),
        voidsEventId: null,
      },
      RULES,
    );
    expect(started.ok).toBe(true);
    log.events.push({
      id: 'h1',
      seq: 3,
      type: 'HOLD_STARTED',
      side: 'RED',
      actionCode: null,
      value: null,
      matchClockMs: 175_000,
      deviceTime: new Date(T0 + 175_000).toISOString(),
      voidsEventId: null,
    });
    log.stop(180_000);
    // Время вышло, удержание идёт — исхода ещё нет.
    expect(determineOutcome(log.state(), RULES)).toBeNull();
    log.events.push({
      id: 'h2',
      seq: 5,
      type: 'HOLD_ENDED',
      side: 'RED',
      actionCode: null,
      value: 20_000,
      matchClockMs: 180_000,
      deviceTime: new Date(T0 + 195_000).toISOString(),
      voidsEventId: null,
    });
    expect(determineOutcome(log.state(), RULES)).toMatchObject({ winnerSide: 'RED', method: 'POINTS' });
  });
});

describe('scoring: voiding is a compensating event', () => {
  it('leaves the original in the log and recomputes the score without it', () => {
    const log = new Log();
    log.start();
    log.score('RED', 'THROW_4');
    const two = log.score('RED', 'THROW_2');
    log.void(two);
    const s = log.state();
    expect(s.red.points).toBe(4);
    expect(s.seq).toBe(4);
    expect(log.events).toHaveLength(4);
    expect(voidRejection(log.events, two.id)).toBe('already_voided');
  });

  it('cancels a whole hold when its start or end is voided', () => {
    const log = new Log();
    log.start();
    const end = log.hold('BLUE', 20_000);
    log.void(end);
    expect(log.state().blue).toMatchObject({ points: 0, holds: 0 });
    expect(lastVoidableEvent(log.events)).toBeNull();
  });

  it('re-derives later penalties by order after an earlier one is voided', () => {
    const log = new Log();
    log.start();
    const remark = log.penalty('RED');
    log.penalty('RED');
    log.void(remark);
    const s = log.state();
    expect(s.red.penalties).toEqual(['REMARK']);
    expect(s.blue.points).toBe(0);
  });

  it('cannot void clock readings', () => {
    const log = new Log();
    const start = log.start();
    expect(voidRejection(log.events, start.id)).toBe('not_voidable');
    expect(voidRejection(log.events, 'missing')).toBe('event_not_found');
  });
});

describe('outcome after the time is over', () => {
  const finished = (build: (log: Log) => void): MatchState => {
    const log = new Log();
    log.start();
    build(log);
    log.stop(DURATION);
    return log.state();
  };

  it('is null while the time runs', () => {
    const log = new Log();
    log.start();
    log.score('RED', 'THROW_2');
    expect(determineOutcome(log.state(), RULES)).toBeNull();
  });

  it('goes to the side with more points', () => {
    const s = finished((log) => {
      log.score('RED', 'THROW_1');
      log.score('BLUE', 'THROW_2');
    });
    expect(determineOutcome(s, RULES)).toMatchObject({ winnerSide: 'BLUE', basis: 'POINTS' });
  });

  it('uses the tie-breakers of the rules in order: last technical action first', () => {
    const s = finished((log) => {
      log.score('BLUE', 'THROW_2');
      log.score('RED', 'THROW_2');
    });
    expect(determineOutcome(s, RULES)).toEqual({
      winnerSide: 'RED',
      method: 'POINTS',
      methodDetail: 'LAST_TECHNICAL_ACTION',
      basis: 'TIE_BREAKER',
    });
  });

  it('then fewer penalties, then a referee decision', () => {
    // Равный счёт без технических действий: 1:1 за наказания — у обоих по два.
    const s = finished((log) => {
      log.penalty('RED');
      log.penalty('RED');
      log.penalty('BLUE');
      log.penalty('BLUE');
    });
    expect(determineOutcome(s, RULES)).toEqual({
      winnerSide: null,
      method: 'DECISION',
      methodDetail: 'REFEREE_DECISION',
      basis: 'REFEREE_DECISION',
    });
    // Красный: бросок на 1; синий: 1 за предупреждение красного. Наказаний у красного больше.
    const tied = finished((log) => {
      log.penalty('RED');
      log.penalty('RED');
      log.score('RED', 'THROW_1');
      log.penalty('BLUE');
    });
    expect([tied.red.points, tied.blue.points]).toEqual([1, 1]);
    expect(determineOutcome(tied, { tieBreakers: ['FEWER_PENALTIES', 'REFEREE_DECISION'] })).toMatchObject({
      winnerSide: 'BLUE',
      methodDetail: 'FEWER_PENALTIES',
    });
  });

  it('compares the highest scores when asked', () => {
    const s = finished((log) => {
      log.score('RED', 'THROW_4');
      log.score('BLUE', 'THROW_2');
      log.score('BLUE', 'THROW_2');
    });
    expect([s.red.points, s.blue.points]).toEqual([4, 4]);
    expect(determineOutcome(s, { tieBreakers: ['MORE_HIGH_SCORES'] })).toMatchObject({
      winnerSide: 'RED',
      methodDetail: 'MORE_HIGH_SCORES',
    });
  });
});

describe('clock', () => {
  it('refuses to start twice, to go backwards or to start after the time is over', () => {
    const log = new Log();
    log.start();
    const again = applyEvent(log.state(), { ...log.events[0]!, id: 'x', seq: 2 }, RULES);
    expect(again).toEqual({ ok: false, reason: 'clock_running' });
    log.stop(30_000);
    const back = applyEvent(log.state(), { ...log.events[0]!, id: 'y', seq: 3, matchClockMs: 10_000 }, RULES);
    expect(back).toEqual({ ok: false, reason: 'clock_not_monotonic' });
    const log2 = new Log();
    log2.start();
    log2.stop(DURATION);
    const late = applyEvent(
      log2.state(),
      { ...log2.events[0]!, id: 'z', seq: 3, matchClockMs: DURATION },
      RULES,
    );
    expect(late).toEqual({ ok: false, reason: 'time_expired' });
  });

  it('extrapolates a running clock from the last reading', () => {
    const at = new Date(T0).toISOString();
    expect(clockNowMs({ running: true, elapsedMs: 10_000, at }, T0 + 2500, DURATION)).toBe(12_500);
    expect(clockNowMs({ running: true, elapsedMs: 179_000, at }, T0 + 5000, DURATION)).toBe(DURATION);
    expect(clockNowMs({ running: false, elapsedMs: 10_000, at }, T0 + 2500, DURATION)).toBe(10_000);
  });
});

describe('match command schemas', () => {
  it('requires the side and the action where the event needs them', () => {
    const base = { expectedSeq: 0, matchClockMs: 0, deviceTime: '2026-11-14T07:00:00.000Z' };
    expect(MatchEventCreate.safeParse({ ...base, type: 'CLOCK_STARTED' }).success).toBe(true);
    expect(MatchEventCreate.safeParse({ ...base, type: 'SCORE', side: 'RED' }).success).toBe(false);
    expect(MatchEventCreate.safeParse({ ...base, type: 'HOLD_ENDED', side: 'RED' }).success).toBe(false);
    expect(MatchEventCreate.safeParse({ ...base, type: 'EVENT_VOIDED' }).success).toBe(false);
  });

  it('accepts only the methods a mat crew records', () => {
    expect(MatchResultInput.safeParse({ expectedSeq: 3, winnerSide: 'RED', method: 'POINTS' }).success).toBe(
      true,
    );
    expect(MatchResultInput.safeParse({ expectedSeq: 3, winnerSide: 'RED', method: 'BYE' }).success).toBe(
      false,
    );
    expect(MatchNoShowRequest.safeParse({ side: 'BOTH' }).success).toBe(true);
  });
});
