import { describe, expect, it } from 'vitest';
import { DrawCreate, DrawSupersede, RandomSeed } from './draws.js';
import {
  drawSize,
  eliminationRoundLabel,
  formatForCount,
  isDrawFormat,
  meetingRound,
  nextPowerOfTwo,
  poolOfPosition,
} from './formats.js';
import { SAMPLE_RULESET_PARAMETERS } from './rulesets.js';

describe('formats (Phase 5a)', () => {
  it('sizes elimination brackets to a power of two and round robin to the participants', () => {
    expect([2, 3, 5, 8, 9, 64, 65].map(nextPowerOfTwo)).toEqual([2, 4, 8, 8, 16, 64, 128]);
    expect(drawSize('ELIMINATION_WITH_REPECHAGE', 10)).toBe(16);
    expect(drawSize('SINGLE_ELIMINATION', 2)).toBe(2);
    expect(drawSize('ROUND_ROBIN', 5)).toBe(5);
  });

  it('chooses the format by the number of participants from the rules', () => {
    const rows = SAMPLE_RULESET_PARAMETERS.formatSelection;
    expect(formatForCount(rows, 1)).toBeNull();
    expect(formatForCount(rows, 2)).toBe('ROUND_ROBIN');
    expect(formatForCount(rows, 5)).toBe('ROUND_ROBIN');
    expect(formatForCount(rows, 6)).toBe('ELIMINATION_WITH_REPECHAGE');
    expect(formatForCount(rows, 200)).toBe('ELIMINATION_WITH_REPECHAGE');
    expect(isDrawFormat('DOUBLE_ELIMINATION')).toBe(false);
    expect(isDrawFormat('SINGLE_ELIMINATION')).toBe(true);
  });

  it('knows where two positions meet and which pool a position is in', () => {
    expect(meetingRound(1, 2)).toBe(1);
    expect(meetingRound(1, 3)).toBe(2);
    expect(meetingRound(4, 5)).toBe(3);
    expect(meetingRound(1, 16)).toBe(4);
    expect(poolOfPosition('ELIMINATION_WITH_REPECHAGE', 16, 8)).toBe('A');
    expect(poolOfPosition('ELIMINATION_WITH_REPECHAGE', 16, 9)).toBe('B');
    expect(poolOfPosition('SINGLE_ELIMINATION', 16, 9)).toBeNull();
    expect(poolOfPosition('ELIMINATION_WITH_REPECHAGE', 2, 1)).toBeNull();
  });

  it('labels rounds by the number of places in them', () => {
    expect([1, 2, 3, 4].map((r) => eliminationRoundLabel(16, r))).toEqual([
      'ROUND_OF_16',
      'QUARTERFINAL',
      'SEMIFINAL',
      'FINAL',
    ]);
    expect(eliminationRoundLabel(2, 1)).toBe('FINAL');
    expect(eliminationRoundLabel(128, 1)).toBe('ROUND_OF_128');
  });
});

describe('draw requests', () => {
  it('fills defaults and accepts only 5a formats', () => {
    expect(DrawCreate.parse({})).toEqual({ seeding: [], separation: { by: ['ORGANIZATION', 'REGION'] } });
    expect(DrawCreate.safeParse({ format: 'GROUP_STAGE' }).success).toBe(false);
    expect(DrawCreate.safeParse({ separation: { by: ['REGION', 'REGION'] } }).success).toBe(false);
    expect(DrawCreate.safeParse({ separation: { by: [] } }).success).toBe(true);
  });

  it('validates the random seed', () => {
    expect(RandomSeed.safeParse('0123456789abcdef0123456789abcdef').success).toBe(true);
    expect(RandomSeed.safeParse('0'.repeat(32)).success).toBe(false);
    expect(RandomSeed.safeParse('0123456789ABCDEF0123456789ABCDEF').success).toBe(false);
    expect(RandomSeed.safeParse('abc').success).toBe(false);
  });

  it('requires a reason for a new version', () => {
    expect(DrawSupersede.safeParse({ reason: 'Ошибка в посеве' }).success).toBe(true);
    expect(DrawSupersede.safeParse({ reason: 'нет' }).success).toBe(false);
  });
});
