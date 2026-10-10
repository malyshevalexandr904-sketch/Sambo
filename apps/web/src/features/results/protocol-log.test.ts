import type { MatchProtocolDto, ProtocolEventRow } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import { protocolLog } from './protocol-log';

const ev = (
  seq: number,
  type: string,
  ms: number,
  red: number,
  blue: number,
  extra: Partial<ProtocolEventRow> = {},
): ProtocolEventRow => ({
  seq,
  matchClockMs: ms,
  type,
  side: type.startsWith('CLOCK') ? null : 'RED',
  actionCode: null,
  value: null,
  points: null,
  pointsTo: null,
  red,
  blue,
  voided: false,
  voidReason: null,
  voidedAtMs: null,
  ...extra,
});

const incident = (id: string, ms: number): MatchProtocolDto['incidents'][number] => ({
  id,
  matchId: 'm',
  side: 'BLUE',
  entryId: 'e',
  kind: 'ASSISTANCE',
  decision: 'CONTINUE',
  matchClockMs: ms,
  recordedAt: '2026-10-08T08:00:00Z',
  recordedBy: null,
});

describe('protocolLog', () => {
  it('skips hold starts and shows a hold at its start time', () => {
    const log = protocolLog({
      events: [
        ev(1, 'CLOCK_STARTED', 0, 0, 0),
        ev(2, 'HOLD_STARTED', 72_000, 0, 0),
        ev(3, 'HOLD_ENDED', 84_000, 2, 0, { value: 12_000, points: 2 }),
        ev(4, 'CLOCK_STOPPED', 180_000, 2, 0),
      ],
      incidents: [],
    });
    expect(log.map((r) => [r.key, r.time])).toEqual([
      ['e1', 0],
      ['e3', 72_000],
      ['e4', 180_000],
    ]);
    expect(log[0]).toMatchObject({ kind: 'event', mark: true });
    expect(log[1]).toMatchObject({ kind: 'event', mark: false, score: '2 : 0' });
  });

  it('puts a doctor record at its time with the score at that moment', () => {
    const log = protocolLog({
      events: [
        ev(1, 'CLOCK_STARTED', 0, 0, 0),
        ev(2, 'SCORE', 24_000, 2, 0),
        ev(3, 'CLOCK_STOPPED', 118_000, 2, 0),
        ev(4, 'CLOCK_STARTED', 118_000, 2, 0),
        ev(5, 'SCORE', 130_000, 3, 0),
      ],
      incidents: [incident('a', 118_000)],
    });
    expect(log.map((r) => r.key)).toEqual(['e1', 'e2', 'e3', 'e4', 'ma', 'e5']);
    expect(log[4]).toMatchObject({ kind: 'incident', score: '2 : 0' });
  });

  it('records before any event start from 0 : 0 and after all events go last', () => {
    const early = protocolLog({ events: [ev(1, 'SCORE', 5_000, 1, 0)], incidents: [incident('x', 0)] });
    expect(early.map((r) => r.key)).toEqual(['mx', 'e1']);
    expect(early[0]).toMatchObject({ score: '0 : 0' });
    const late = protocolLog({ events: [ev(1, 'SCORE', 5_000, 1, 0)], incidents: [incident('y', 9_000)] });
    expect(late.map((r) => r.key)).toEqual(['e1', 'my']);
    expect(late[1]).toMatchObject({ score: '1 : 0' });
  });
});
