import { describe, expect, it } from 'vitest';
import {
  isNewerMatchState,
  isPublicLiveChannel,
  liveChannel,
  liveClockMs,
  liveHoldMs,
  type LiveMatchDto,
  parseLiveChannel,
} from './index.js';

const ID = '01920000-0000-7000-8000-000000000001';

describe('live channels', () => {
  it('parses every channel kind built by liveChannel', () => {
    expect(parseLiveChannel(liveChannel.publicMat('kubok-2026', 3))).toEqual({
      kind: 'public:mat',
      slug: 'kubok-2026',
      matNumber: 3,
    });
    expect(parseLiveChannel(liveChannel.publicMatch('8QeW3rT1kZpA'))).toEqual({
      kind: 'public:match',
      publicId: '8QeW3rT1kZpA',
    });
    expect(parseLiveChannel(liveChannel.publicCompetition('kubok-2026'))).toEqual({
      kind: 'public:competition',
      slug: 'kubok-2026',
    });
    expect(parseLiveChannel(liveChannel.opsCompetition(ID))).toEqual({
      kind: 'ops:competition',
      competitionId: ID,
    });
    expect(parseLiveChannel(liveChannel.opsMat(ID))).toEqual({ kind: 'ops:mat', matId: ID });
    expect(parseLiveChannel(liveChannel.opsMatch(ID))).toEqual({ kind: 'ops:match', matchId: ID });
    expect(parseLiveChannel(liveChannel.user)).toEqual({ kind: 'user' });
  });

  it('rejects unknown and malformed names', () => {
    for (const name of [
      'user:other-id',
      'ops:competition:not-a-uuid',
      'public:mat:kubok:0',
      'public:mat:kubok:01',
      'public:mat:kubok:1000',
      'public:mat:Kubok:1',
      'public:mat:kubok:1:extra',
      'ops:mat:*',
      'x'.repeat(200),
    ])
      expect(parseLiveChannel(name), name).toBeNull();
    expect(isPublicLiveChannel(liveChannel.publicMat('a-b', 1))).toBe(true);
    expect(isPublicLiveChannel(liveChannel.opsMat(ID))).toBe(false);
  });
});

describe('scoreboard time and ordering', () => {
  const at = '2026-10-10T10:00:00.000Z';
  const now = Date.parse(at) + 15_000;

  it('counts the running clock from the moment of the last reading, not beyond the bout', () => {
    expect(liveClockMs({ running: true, elapsedMs: 60_000, durationMs: 180_000, at }, now)).toBe(75_000);
    expect(liveClockMs({ running: false, elapsedMs: 60_000, durationMs: 180_000, at }, now)).toBe(60_000);
    expect(liveClockMs({ running: true, elapsedMs: 170_000, durationMs: 180_000, at }, now)).toBe(180_000);
    expect(liveHoldMs({ side: 'RED', startedAt: at, maxMs: 20_000 }, now)).toBe(15_000);
    expect(liveHoldMs({ side: 'RED', startedAt: at, maxMs: 10_000 }, now)).toBe(10_000);
  });

  it('a state of the same bout is newer by version, then by event number', () => {
    const m = { publicId: 'a', version: 3, seq: 5 } as LiveMatchDto;
    expect(isNewerMatchState({ ...m, seq: 6 }, m)).toBe(true);
    expect(isNewerMatchState({ ...m, seq: 4 }, m)).toBe(false);
    expect(isNewerMatchState({ ...m, version: 4, seq: 0 }, m)).toBe(true);
    expect(isNewerMatchState({ ...m, publicId: 'b', version: 1 }, m)).toBe(true);
    expect(isNewerMatchState(m, null)).toBe(true);
  });
});
