import { describe, expect, it } from 'vitest';
import { type LogEvent, localizeTimes, mergeLog } from './scoring-queue';

const ev = (over: Partial<LogEvent>): LogEvent => ({
  id: 'e1',
  seq: 1,
  type: 'CLOCK_STARTED',
  side: null,
  actionCode: null,
  value: null,
  matchClockMs: 0,
  deviceTime: '2026-10-07T10:00:00.000Z',
  voidsEventId: null,
  deviceId: 'tablet-a',
  serverTime: '2026-10-07T10:00:00.000Z',
  ...over,
});

describe('localizeTimes — время чужого планшета к часам этого', () => {
  it('часы другого планшета спешат на 30 с: его время сводится к часам сервера и этого планшета', () => {
    // Планшет A спешит на 30 с: событие пришло на сервер в 10:00:00.2, на A было 10:00:30.
    const a = ev({ deviceTime: '2026-10-07T10:00:30.000Z', serverTime: '2026-10-07T10:00:00.200Z' });
    // Этот планшет отстаёт от сервера на 5 с (сервер − планшет = +5 с).
    const [out] = localizeTimes([a], 'tablet-b', 5000);
    expect(out?.deviceTime).toBe('2026-10-07T09:59:55.200Z');
  });

  it('сдвиг устройства — по событию без задержки: отправленное после обрыва связи не сбивает часы', () => {
    const prompt = ev({
      id: 'p',
      deviceTime: '2026-10-07T10:00:00.000Z',
      serverTime: '2026-10-07T10:00:00.100Z',
    });
    const late = ev({
      id: 'l',
      seq: 2,
      deviceTime: '2026-10-07T10:01:00.000Z',
      serverTime: '2026-10-07T10:01:20.000Z', // ушло через 20 с — связи не было
    });
    const out = localizeTimes([prompt, late], 'tablet-b', 0);
    expect(out[1]?.deviceTime).toBe('2026-10-07T10:01:00.100Z');
  });

  it('свои события и события без устройства не меняются', () => {
    const own = ev({ deviceId: 'tablet-b', serverTime: '2026-10-07T10:00:09.000Z' });
    const none = ev({ id: 'n', deviceId: null });
    expect(localizeTimes([own, none], 'tablet-b', 1000)).toEqual([own, none]);
  });
});

describe('mergeLog — журнал без повторов и по номеру', () => {
  it('подтверждённое во время загрузки событие не теряется, повтор не дублируется', () => {
    const e1 = ev({ id: 'e1', seq: 1 });
    const e2 = ev({ id: 'e2', seq: 2 });
    const e3 = ev({ id: 'e3', seq: 3 });
    expect(mergeLog([e3], [e1, e2, e3]).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
