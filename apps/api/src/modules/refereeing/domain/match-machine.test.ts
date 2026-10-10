import { describe, expect, it } from 'vitest';
import { findMatchTransition, isLive, matchTransitionsFrom, noShowAllowed } from './match-machine';

describe('match state machine (ARCHITECTURE.md, 16.6)', () => {
  it('calls, starts, pauses and resumes with the right permission', () => {
    expect(findMatchTransition('SCHEDULED', 'READY')?.permission).toBe('match.update');
    expect(findMatchTransition('READY', 'SCHEDULED')?.permission).toBe('match.update');
    expect(findMatchTransition('READY', 'IN_PROGRESS')?.permission).toBe('match.start');
    expect(findMatchTransition('IN_PROGRESS', 'PAUSED')?.permission).toBe('match.update');
    expect(findMatchTransition('PAUSED', 'IN_PROGRESS')?.permission).toBe('match.start');
    expect(findMatchTransition('IN_PROGRESS', 'FINISHED')?.permission).toBe('match.finish');
  });

  it('does not start a match that was not called and does not reopen a finished one', () => {
    expect(findMatchTransition('SCHEDULED', 'IN_PROGRESS')).toBeNull();
    expect(matchTransitionsFrom('FINISHED')).toEqual([]);
    expect(matchTransitionsFrom('CANCELLED')).toEqual([]);
  });

  it('records events only on the mat and a no-show only before the start', () => {
    expect(isLive('IN_PROGRESS')).toBe(true);
    expect(isLive('PAUSED')).toBe(true);
    expect(isLive('READY')).toBe(false);
    expect(noShowAllowed('READY')).toBe(true);
    expect(noShowAllowed('IN_PROGRESS')).toBe(false);
  });
});

describe('postpone and cancel (Phase 7b)', () => {
  it('postpones a scheduled or called match and returns it to the queue', () => {
    expect(findMatchTransition('SCHEDULED', 'POSTPONED')?.permission).toBe('match.update');
    expect(findMatchTransition('READY', 'POSTPONED')?.permission).toBe('match.update');
    expect(findMatchTransition('POSTPONED', 'SCHEDULED')?.permission).toBe('match.update');
    expect(findMatchTransition('POSTPONED', 'READY')).toBeNull();
    expect(findMatchTransition('IN_PROGRESS', 'POSTPONED')).toBeNull();
  });

  it('cancels only before the start, with its own permission', () => {
    expect(findMatchTransition('SCHEDULED', 'CANCELLED')?.permission).toBe('match.cancel');
    expect(findMatchTransition('POSTPONED', 'CANCELLED')?.permission).toBe('match.cancel');
    expect(findMatchTransition('IN_PROGRESS', 'CANCELLED')).toBeNull();
    expect(matchTransitionsFrom('CANCELLED')).toEqual([]);
  });
});
