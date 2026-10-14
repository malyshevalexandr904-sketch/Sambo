import { describe, expect, it } from 'vitest';
import { scheduleChanges, TIME_CHANGE_NOTICE_MS } from './schedule-changes';

const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 9, min));

describe('scheduleChanges', () => {
  it('lists real changes for clubs and only mat moves and noticeable shifts for families', () => {
    const before = new Map([
      ['same', { matId: 'm1', plannedAt: at(0) }],
      ['small', { matId: 'm1', plannedAt: at(5) }],
      ['big', { matId: 'm1', plannedAt: at(10) }],
      ['mat', { matId: 'm1', plannedAt: at(15) }],
      ['gone', { matId: 'm1', plannedAt: at(20) }],
    ]);
    const r = scheduleChanges(before, [
      { matchId: 'same', matId: 'm1', plannedAt: at(0) },
      { matchId: 'small', matId: 'm1', plannedAt: at(14) },
      { matchId: 'big', matId: 'm1', plannedAt: new Date(at(10).getTime() + TIME_CHANGE_NOTICE_MS) },
      { matchId: 'mat', matId: 'm2', plannedAt: at(15) },
      { matchId: 'new', matId: 'm2', plannedAt: at(30) },
    ]);
    expect(r.changed.sort()).toEqual(['big', 'gone', 'mat', 'new', 'small']);
    expect(r.noticeable.sort()).toEqual(['big', 'mat']);
  });
});
