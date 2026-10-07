import { describe, expect, it } from 'vitest';
import { projectQueue, type QueueItem } from './queue';

const MIN = 60_000;
const NOW = Date.parse('2030-01-01T10:00:00.000Z');
const item = (over: Partial<QueueItem> & Pick<QueueItem, 'matchId' | 'plannedAt'>): QueueItem => ({
  durationSeconds: 180,
  status: 'SCHEDULED',
  startedAt: null,
  elapsedMs: 0,
  ...over,
});

describe('mat queue with the actual course of the mat (Phase 7a, §1)', () => {
  it('keeps the planned time when the mat is on schedule', () => {
    const p = projectQueue(
      [item({ matchId: 'a', plannedAt: NOW + 5 * MIN }), item({ matchId: 'b', plannedAt: NOW + 10 * MIN })],
      NOW,
      60,
    );
    expect(p.expectedAt.get('a')).toBe(NOW + 5 * MIN);
    expect(p.expectedAt.get('b')).toBe(NOW + 10 * MIN);
    expect(p.delaySeconds).toBe(0);
  });

  it('shifts the next matches after a late match in progress, with the changeover', () => {
    const p = projectQueue(
      [
        item({
          matchId: 'a',
          plannedAt: NOW - 30 * MIN,
          status: 'IN_PROGRESS',
          startedAt: NOW - MIN,
          elapsedMs: MIN,
        }),
        item({ matchId: 'b', plannedAt: NOW - 26 * MIN }),
        item({ matchId: 'c', plannedAt: NOW - 22 * MIN }),
      ],
      NOW,
      60,
    );
    expect(p.expectedAt.get('a')).toBe(NOW - MIN);
    // Осталось 2 минуты схватки + 1 минута смены пары.
    expect(p.expectedAt.get('b')).toBe(NOW + 3 * MIN);
    expect(p.expectedAt.get('c')).toBe(NOW + 7 * MIN);
    expect(p.delaySeconds).toBe(29 * 60);
  });

  it('starts the first waiting match not earlier than now when the mat stands still', () => {
    const p = projectQueue([item({ matchId: 'a', plannedAt: NOW - 10 * MIN })], NOW, 60);
    expect(p.expectedAt.get('a')).toBe(NOW);
    expect(p.delaySeconds).toBe(600);
  });
});
