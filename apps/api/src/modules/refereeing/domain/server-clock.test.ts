import { describe, expect, it } from 'vitest';
import { type TimedEvent, toServerClock } from './server-clock';

const ev = (p: Partial<TimedEvent>): TimedEvent => ({
  id: p.id ?? 'e',
  seq: p.seq ?? 1,
  type: p.type ?? 'CLOCK_STARTED',
  side: null,
  actionCode: null,
  value: null,
  matchClockMs: 0,
  deviceTime: p.deviceTime ?? '2026-10-10T10:00:00.000Z',
  voidsEventId: null,
  deviceId: p.deviceId === undefined ? 'tab-1' : p.deviceId,
  serverTime: p.serverTime ?? '2026-10-10T10:00:00.000Z',
});

describe('toServerClock', () => {
  it('shifts device time by the smallest observed offset of that device', () => {
    // Планшет спешит на 30 с; второе событие ушло через 20 с после записи (связи не было).
    const out = toServerClock([
      ev({ id: 'a', deviceTime: '2026-10-10T10:00:30.000Z', serverTime: '2026-10-10T10:00:00.150Z' }),
      ev({ id: 'b', seq: 2, deviceTime: '2026-10-10T10:01:00.000Z', serverTime: '2026-10-10T10:00:50.000Z' }),
    ]);
    expect(out[0]?.deviceTime).toBe('2026-10-10T10:00:00.150Z');
    // Тот же сдвиг (−29.85 с), а не 20 с задержки очереди.
    expect(out[1]?.deviceTime).toBe('2026-10-10T10:00:30.150Z');
    expect(out[1]).not.toHaveProperty('serverTime');
  });

  it('keeps devices independent and uses own offset for events without device', () => {
    const out = toServerClock([
      ev({ id: 'a', deviceId: 'tab-1', deviceTime: '2026-10-10T10:00:10.000Z' }),
      ev({ id: 'b', deviceId: 'tab-2', deviceTime: '2026-10-10T09:59:55.000Z' }),
      ev({
        id: 'c',
        deviceId: null,
        deviceTime: '2026-10-10T09:00:00.000Z',
        serverTime: '2026-10-10T10:00:01.000Z',
      }),
    ]);
    expect(out.map((e) => e.deviceTime)).toEqual([
      '2026-10-10T10:00:00.000Z',
      '2026-10-10T10:00:00.000Z',
      '2026-10-10T10:00:01.000Z',
    ]);
  });
});
