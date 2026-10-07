import type { ScoringEvent } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { commandRequest, isTransient, type Pending, planUndo, relink } from './use-scoring';

let n = 0;
const ev = (over: Partial<ScoringEvent>): ScoringEvent => ({
  id: `e${++n}`,
  seq: n,
  type: 'SCORE',
  side: 'RED',
  actionCode: 'THROW_2',
  value: null,
  matchClockMs: 1000 * n,
  deviceTime: '2026-10-07T10:00:00.000Z',
  voidsEventId: null,
  ...over,
});
const pending = (e: ScoringEvent, sentSeq: number | null = null): Pending => ({
  key: `k-${e.id}`,
  preview: e,
  sentSeq,
});

describe('planUndo — «Отменить последнее» на планшете', () => {
  it('подтверждённое событие отменяется на сервере', () => {
    const a = ev({ id: 'srv-1', seq: 1 });
    expect(planUndo([a], [])).toEqual({ drop: [], voidId: 'srv-1' });
  });

  it('неотправленное — убирается из очереди на месте', () => {
    const a = ev({ id: 'srv-1', seq: 1 });
    const b = ev({ id: 'local:b', seq: 2 });
    expect(planUndo([a], [pending(b)])).toEqual({ drop: ['local:b'], voidId: null });
  });

  it('отправляемое сейчас (в том числе без связи) — отменяется на сервере по временному номеру', () => {
    const b = ev({ id: 'local:b', seq: 2 });
    expect(planUndo([], [pending(b, 1)])).toEqual({ drop: [], voidId: 'local:b' });
  });

  it('конец удержания — вместе с началом: оба не отправлены → оба убираются', () => {
    const start = ev({ id: 'local:s', seq: 3, type: 'HOLD_STARTED', actionCode: null });
    const end = ev({ id: 'local:e', seq: 4, type: 'HOLD_ENDED', actionCode: null, value: 10_000 });
    expect(planUndo([], [pending(start), pending(end)])).toEqual({
      drop: ['local:e', 'local:s'],
      voidId: null,
    });
  });

  it('конец удержания не отправлен, начало на сервере → конец убирается, начало отменяется на сервере', () => {
    const start = ev({ id: 'srv-s', seq: 3, type: 'HOLD_STARTED', actionCode: null });
    const end = ev({ id: 'local:e', seq: 4, type: 'HOLD_ENDED', actionCode: null, value: 10_000 });
    expect(planUndo([start], [pending(end)])).toEqual({ drop: ['local:e'], voidId: 'srv-s' });
  });

  it('уже отменённое не предлагается; отменять нечего → null', () => {
    const a = ev({ id: 'srv-1', seq: 1 });
    const v = ev({
      id: 'srv-2',
      seq: 2,
      type: 'EVENT_VOIDED',
      side: null,
      actionCode: null,
      voidsEventId: 'srv-1',
    });
    expect(planUndo([a, v], [])).toBeNull();
    const clock = ev({ id: 'srv-3', seq: 3, type: 'CLOCK_STARTED', side: null, actionCode: null });
    expect(planUndo([clock], [])).toBeNull();
  });
});

describe('relink — отмена по временному номеру после подтверждения события', () => {
  it('ссылка отмены переводится на серверный номер, прочие события не меняются', () => {
    const v = ev({
      id: 'local:v',
      type: 'EVENT_VOIDED',
      side: null,
      actionCode: null,
      voidsEventId: 'local:b',
    });
    const other = ev({ id: 'local:c' });
    const out = relink([pending(v), pending(other)], 'local:b', 'srv-9');
    expect(out[0]?.preview.voidsEventId).toBe('srv-9');
    expect(out[1]).toEqual(pending(other));
  });
});

describe('commandRequest — тело команды одинаково при повторе', () => {
  it('событие: тип, сторона, код, значение только если заданы', () => {
    const e = ev({ id: 'local:x', type: 'CLOCK_STARTED', side: null, actionCode: null, matchClockMs: 0 });
    const r = commandRequest('m1', e, 5, 'tablet-1');
    expect(r.path).toBe('/matches/m1/events');
    expect(r.body).toEqual({
      expectedSeq: 5,
      matchClockMs: 0,
      deviceTime: e.deviceTime,
      deviceId: 'tablet-1',
      type: 'CLOCK_STARTED',
    });
    expect(commandRequest('m1', e, 5, 'tablet-1')).toEqual(r);
  });

  it('отмена — на адрес отменяемого события', () => {
    const v = ev({
      id: 'local:v',
      type: 'EVENT_VOIDED',
      side: null,
      actionCode: null,
      voidsEventId: 'srv-1',
    });
    const r = commandRequest('m1', v, 7, 'tablet-1');
    expect(r.path).toBe('/matches/m1/events/srv-1/void');
    expect(r.body).toMatchObject({ expectedSeq: 7 });
    expect(r.body).not.toHaveProperty('type');
  });
});

describe('isTransient — что повторять с тем же ключом', () => {
  it('сеть, 5xx, лимит и «повтор ещё выполняется» — повторяем; отказ правил и конфликт — нет', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
    expect(isTransient(new ApiError(0, 'NETWORK', undefined, null))).toBe(true);
    expect(isTransient(new ApiError(503, 'UNKNOWN', undefined, null))).toBe(true);
    expect(isTransient(new ApiError(429, 'RATE_LIMITED', undefined, null))).toBe(true);
    expect(isTransient(new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', { inProgress: true }, null))).toBe(true);
    expect(isTransient(new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', undefined, null))).toBe(false);
    expect(isTransient(new ApiError(409, 'EXPECTED_SEQ_MISMATCH', undefined, null))).toBe(false);
    expect(
      isTransient(new ApiError(422, 'EVENT_NOT_ALLOWED_BY_RULESET', { reason: 'hold_active' }, null)),
    ).toBe(false);
  });
});
