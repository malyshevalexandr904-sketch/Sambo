// Оценка активности «А» (правила FIAS, ст. 14.11–14.12, 16.2, 29.9) и секундомер болевого приёма (правки 04.11.2026).
import { describe, expect, it } from 'vitest';
import { MatchEventCreate } from './matches.js';
import { SAMPLE_RULESET_PARAMETERS } from './rulesets.js';
import {
  applyEvent,
  determineOutcome,
  lastVoidableEvent,
  type MatchState,
  replayEvents,
  type ScoringEvent,
} from './scoring.js';

const RULES = SAMPLE_RULESET_PARAMETERS;
const DURATION = 180_000;
const T0 = Date.parse('2026-11-14T07:00:00.000Z');

function log() {
  const events: ScoringEvent[] = [];
  const add = (e: Partial<ScoringEvent> & Pick<ScoringEvent, 'type'>): ScoringEvent => {
    const seq = events.length + 1;
    const clock = e.matchClockMs ?? 0;
    const ev: ScoringEvent = {
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
    events.push(ev);
    return ev;
  };
  return {
    events,
    add,
    state: (): MatchState => replayEvents(events, RULES, DURATION),
  };
}

const next = (s: MatchState, e: Partial<ScoringEvent> & Pick<ScoringEvent, 'type'>) =>
  applyEvent(
    s,
    {
      id: 'x',
      seq: s.seq + 1,
      side: null,
      actionCode: null,
      value: null,
      deviceTime: new Date(T0).toISOString(),
      voidsEventId: null,
      matchClockMs: 1000,
      ...e,
    },
    RULES,
  );

describe('activity mark', () => {
  it('is given while there are no scores and wins a blank bout', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'ACTIVITY', side: 'BLUE', matchClockMs: 60_000 });
    l.add({ type: 'CLOCK_STOPPED', matchClockMs: DURATION });
    const s = l.state();
    expect(s.activity).toEqual({ side: 'BLUE' });
    expect(determineOutcome(s, RULES)).toEqual({
      winnerSide: 'BLUE',
      method: 'POINTS',
      methodDetail: 'ACTIVITY',
      basis: 'TIE_BREAKER',
    });
  });

  it('is given only once per bout', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'ACTIVITY', side: 'RED' });
    expect(next(l.state(), { type: 'ACTIVITY', side: 'BLUE' })).toEqual({
      ok: false,
      reason: 'activity_used',
    });
  });

  it('is not allowed after a technical score', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'SCORE', side: 'RED', actionCode: 'THROW_1' });
    expect(next(l.state(), { type: 'ACTIVITY', side: 'BLUE' })).toEqual({
      ok: false,
      reason: 'activity_not_allowed',
    });
  });

  it('lapses when a points difference appears, and stays used', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'ACTIVITY', side: 'RED' });
    l.add({ type: 'SCORE', side: 'BLUE', actionCode: 'THROW_1' });
    const s = l.state();
    expect(s.activity).toEqual({ side: null });
    expect(next(s, { type: 'ACTIVITY', side: 'RED' })).toEqual({ ok: false, reason: 'activity_used' });
  });

  it('does not decide a bout with equal technical scores', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'ACTIVITY', side: 'RED' });
    l.add({ type: 'SCORE', side: 'BLUE', actionCode: 'THROW_1' });
    l.add({ type: 'SCORE', side: 'RED', actionCode: 'THROW_1' });
    l.add({ type: 'CLOCK_STOPPED', matchClockMs: DURATION });
    expect(determineOutcome(l.state(), RULES)?.methodDetail).not.toBe('ACTIVITY');
  });

  it('can be undone with the last-event undo', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    const a = l.add({ type: 'ACTIVITY', side: 'RED' });
    expect(lastVoidableEvent(l.events)?.id).toBe(a.id);
    l.add({ type: 'EVENT_VOIDED', voidsEventId: a.id });
    expect(l.state().activity).toBeNull();
  });
});

describe('submission stopwatch', () => {
  it('runs for each athlete separately and does not change the score', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'SUBMISSION_STARTED', side: 'RED', matchClockMs: 10_000 });
    l.add({ type: 'SUBMISSION_STARTED', side: 'BLUE', matchClockMs: 12_000 });
    let s = l.state();
    expect(s.submissions?.red?.clockMs).toBe(10_000);
    expect(s.submissions?.blue?.clockMs).toBe(12_000);
    expect([s.red.points, s.blue.points]).toEqual([0, 0]);
    l.add({ type: 'SUBMISSION_ENDED', side: 'RED', matchClockMs: 20_000 });
    s = l.state();
    expect(s.submissions?.red).toBeNull();
    expect(s.submissions?.blue).not.toBeNull();
    expect(next(s, { type: 'SUBMISSION_STARTED', side: 'BLUE' })).toEqual({
      ok: false,
      reason: 'submission_active',
    });
    expect(next(s, { type: 'SUBMISSION_ENDED', side: 'RED' })).toEqual({
      ok: false,
      reason: 'submission_not_active',
    });
  });

  it('stops when the bout is decided', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    l.add({ type: 'SUBMISSION_STARTED', side: 'RED' });
    l.add({ type: 'SCORE', side: 'RED', actionCode: 'SUBMISSION' });
    expect(l.state().submissions).toEqual({ red: null, blue: null });
  });

  it('works on states recorded before the field existed', () => {
    const l = log();
    l.add({ type: 'CLOCK_STARTED' });
    const old = { ...l.state() };
    delete old.submissions;
    delete old.activity;
    const r = next(old, { type: 'SUBMISSION_STARTED', side: 'BLUE' });
    expect(r.ok && r.state.submissions?.blue).toBeTruthy();
  });

  it('requires a side in the request', () => {
    const base = { expectedSeq: 1, matchClockMs: 0, deviceTime: new Date(T0).toISOString() };
    expect(MatchEventCreate.safeParse({ ...base, type: 'SUBMISSION_STARTED' }).success).toBe(false);
    expect(MatchEventCreate.safeParse({ ...base, type: 'ACTIVITY', side: 'RED' }).success).toBe(true);
  });
});
