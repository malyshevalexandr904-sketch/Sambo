// Свойства счёта схватки (план Phase 7a, §9): счёт — чистая функция журнала и правил; отмена события равна журналу
// без него; баллы складываются из оценок и наказаний соперника; удержания не превышают лимит; исход по баллам —
// у лидера. Журналы строятся случайными командами планшета, принятыми счётом (applyEvent в строгом режиме).
import {
  applyEvent,
  determineOutcome,
  excludedEventIds,
  holdPoints,
  initialMatchState,
  type MatchState,
  replayEvents,
  SAMPLE_RULESET_PARAMETERS,
  type ScoringEvent,
  type Side,
  VOIDABLE_EVENT_TYPES,
} from '@sde/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const RULES = SAMPLE_RULESET_PARAMETERS;
const DURATION = 180_000;
const T0 = Date.parse('2030-01-01T10:00:00.000Z');

type Command =
  | { kind: 'score'; side: Side; code: string }
  | { kind: 'penalty'; side: Side }
  | { kind: 'hold'; side: Side; ms: number }
  | { kind: 'void'; pick: number };

const side = fc.constantFrom<Side>('RED', 'BLUE');
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('score' as const),
    side,
    code: fc.constantFrom(...RULES.actions.map((a) => a.code)),
  }),
  fc.record({ kind: fc.constant('penalty' as const), side }),
  fc.record({ kind: fc.constant('hold' as const), side, ms: fc.integer({ min: 0, max: 25_000 }) }),
  fc.record({ kind: fc.constant('void' as const), pick: fc.nat() }),
);

/** Журнал по командам: секундомер запущен, команды принимаются по правилам, в конце время выходит. */
function buildLog(commands: readonly Command[], stopAtEnd: boolean): ScoringEvent[] {
  const events: ScoringEvent[] = [];
  let state: MatchState = initialMatchState(DURATION);
  let clock = 0;
  const push = (e: Omit<ScoringEvent, 'id' | 'seq' | 'deviceTime'>): boolean => {
    const ev: ScoringEvent = {
      ...e,
      id: `e${events.length + 1}`,
      seq: events.length + 1,
      deviceTime: new Date(T0 + e.matchClockMs).toISOString(),
    };
    if (ev.type === 'EVENT_VOIDED') {
      events.push(ev);
      state = replayEvents(events, RULES, DURATION);
      return true;
    }
    const r = applyEvent(state, ev, RULES);
    if (!r.ok) return false;
    events.push(ev);
    state = r.state;
    return true;
  };
  const base = { side: null, actionCode: null, value: null, voidsEventId: null };
  push({ ...base, type: 'CLOCK_STARTED', matchClockMs: 0 });
  for (const c of commands) {
    clock = Math.min(DURATION - 30_000, clock + 1000);
    if (c.kind === 'score')
      push({ ...base, type: 'SCORE', side: c.side, actionCode: c.code, matchClockMs: clock });
    else if (c.kind === 'penalty') push({ ...base, type: 'PENALTY', side: c.side, matchClockMs: clock });
    else if (c.kind === 'hold') {
      if (push({ ...base, type: 'HOLD_STARTED', side: c.side, matchClockMs: clock }))
        push({ ...base, type: 'HOLD_ENDED', side: c.side, value: c.ms, matchClockMs: clock });
    } else {
      const excluded = excludedEventIds(events);
      const voidable = events.filter((e) => VOIDABLE_EVENT_TYPES.includes(e.type) && !excluded.has(e.id));
      const target = voidable[c.pick % Math.max(1, voidable.length)];
      if (target) push({ ...base, type: 'EVENT_VOIDED', voidsEventId: target.id, matchClockMs: clock });
    }
  }
  if (stopAtEnd) push({ ...base, type: 'CLOCK_STOPPED', matchClockMs: DURATION });
  return events;
}

const score = (s: MatchState) => ({
  red: { points: s.red.points, penalties: s.red.penalties, holds: s.red.holds },
  blue: { points: s.blue.points, penalties: s.blue.penalties, holds: s.blue.holds },
  decision: s.decision,
});

describe('scoring properties', () => {
  it('the same log and rules give the same score', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        const log = buildLog(commands, true);
        expect(replayEvents(log, RULES, DURATION)).toEqual(replayEvents([...log].reverse(), RULES, DURATION));
      }),
    );
  });

  it('voiding an event equals the log without it (a voided hold — without the whole hold)', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), fc.nat(), (commands, pick) => {
        const log = buildLog(commands, false);
        const excluded = excludedEventIds(log);
        const voidable = log.filter((e) => VOIDABLE_EVENT_TYPES.includes(e.type) && !excluded.has(e.id));
        fc.pre(voidable.length > 0);
        const target = voidable[pick % voidable.length] as ScoringEvent;
        const voided: ScoringEvent = {
          id: 'void',
          seq: log.length + 1,
          type: 'EVENT_VOIDED',
          side: null,
          actionCode: null,
          value: null,
          matchClockMs: 0,
          deviceTime: new Date(T0).toISOString(),
          voidsEventId: target.id,
        };
        const withVoid = [...log, voided];
        const gone = excludedEventIds(withVoid);
        const without = log.filter((e) => !gone.has(e.id));
        expect(score(replayEvents(withVoid, RULES, DURATION))).toEqual(
          score(replayEvents(without, RULES, DURATION)),
        );
      }),
    );
  });

  it('points are technical scores plus the penalty points of the opponent; holds stay within the limit', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        const log = buildLog(commands, true);
        const s = replayEvents(log, RULES, DURATION);
        for (const [own, other] of [
          [s.red, s.blue],
          [s.blue, s.red],
        ] as const) {
          const technical = Object.entries(own.technical).reduce((sum, [v, n]) => sum + Number(v) * n, 0);
          const fromPenalties = other.penalties.reduce(
            (sum, code) => sum + (RULES.penalties.find((p) => p.code === code)?.opponentPoints ?? 0),
            0,
          );
          expect(own.points).toBe(technical + fromPenalties);
          expect(own.holds).toBeLessThanOrEqual(RULES.hold.maxPerMatch);
          expect(own.penalties).toEqual(RULES.penalties.slice(0, own.penalties.length).map((p) => p.code));
        }
      }),
    );
  });

  it('after the time the outcome goes to the leader, and an early decision is final', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        const s = replayEvents(buildLog(commands, true), RULES, DURATION);
        const outcome = determineOutcome(s, RULES);
        expect(outcome).not.toBeNull();
        if (s.decision) expect(outcome?.winnerSide).toBe(s.decision.winner);
        else if (s.red.points !== s.blue.points)
          expect(outcome).toMatchObject({
            winnerSide: s.red.points > s.blue.points ? 'RED' : 'BLUE',
            method: 'POINTS',
          });
        else expect(['TIE_BREAKER', 'REFEREE_DECISION']).toContain(outcome?.basis);
        if (s.decision?.kind === 'SUPERIORITY')
          expect(Math.abs(s.red.points - s.blue.points)).toBeGreaterThanOrEqual(RULES.superiorityPoints);
      }),
    );
  });

  it('hold points never exceed the top threshold and grow with the duration', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60_000 }), fc.integer({ min: 0, max: 60_000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(holdPoints(RULES, lo)).toBeLessThanOrEqual(holdPoints(RULES, hi));
        expect(holdPoints(RULES, hi)).toBeLessThanOrEqual(
          Math.max(...RULES.hold.thresholds.map((t) => t.points)),
        );
      }),
    );
  });
});
