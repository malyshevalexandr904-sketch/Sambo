import type { LiveMessage, LiveSubscribeAck } from '@sde/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LiveEvent, LiveClient, type LiveSocket } from './live-client';

type Handler = (...args: never[]) => void;

/** Подмена Socket.IO: события сервера вызываются вручную, ответы на subscribe — по очереди или по требованию. */
class FakeSocket implements LiveSocket {
  connected = false;
  active = true;
  handlers = new Map<string, Handler[]>();
  emitted: { event: string; payload: unknown; ack?: (res: never) => void }[] = [];
  connects = 0;

  on(event: string, fn: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, payload: unknown, ack?: (res: never) => void): this {
    this.emitted.push({ event, payload, ack });
    return this;
  }
  connect(): this {
    this.connects += 1;
    return this;
  }
  disconnect(): this {
    this.connected = false;
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
  }
  open(): void {
    this.connected = true;
    this.fire('connect');
  }
  /** Последний запрос подписки на канал. */
  lastSubscribe(channel: string) {
    return [...this.emitted]
      .reverse()
      .find((e) => e.event === 'subscribe' && (e.payload as { channel: string }).channel === channel);
  }
  answer(channel: string, ack: LiveSubscribeAck): void {
    const req = this.lastSubscribe(channel);
    if (!req?.ack) throw new Error(`no subscribe for ${channel}`);
    (req.ack as (r: LiveSubscribeAck) => void)(ack);
  }
}

const msg = (channel: string, seq: number, type: LiveMessage['type'] = 'changed'): LiveMessage => ({
  v: 1,
  channel,
  seq,
  type,
  occurredAt: '2026-10-10T10:00:00.000Z',
  payload: { n: seq },
});

let socket: FakeSocket;
let refresh: ReturnType<typeof vi.fn>;
let now = 0;
let client: LiveClient;

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  refresh = vi.fn(async () => true);
  now = 1_000_000;
  client = new LiveClient({ createSocket: () => socket, refresh, now: () => now });
});
afterEach(() => {
  client.close();
  vi.useRealTimers();
});

function listen(channel: string): LiveEvent[] {
  const events: LiveEvent[] = [];
  client.subscribe(channel, (e) => events.push(e));
  return events;
}

describe('LiveClient', () => {
  it('subscribes on connect and delivers messages in order', () => {
    const events = listen('ops:x');
    expect(socket.lastSubscribe('ops:x')).toBeUndefined();
    socket.open();
    expect(socket.lastSubscribe('ops:x')?.payload).toEqual({ channel: 'ops:x', lastSeq: undefined });
    socket.answer('ops:x', { ok: true, seq: 4, snapshot: null });
    expect(events).toEqual([{ kind: 'resync', snapshot: null }]);
    socket.fire('message', msg('ops:x', 5));
    socket.fire('message', msg('ops:x', 6));
    expect(events.slice(1).map((e) => (e.kind === 'message' ? e.message.seq : null))).toEqual([5, 6]);
    expect(client.status).toBe('online');
  });

  it('buffers messages that arrive before the subscription is confirmed and drops duplicates', () => {
    const events = listen('public:mat:a:1');
    socket.open();
    socket.fire('message', msg('public:mat:a:1', 3, 'mat.state'));
    socket.fire('message', msg('public:mat:a:1', 4, 'mat.state'));
    socket.answer('public:mat:a:1', { ok: true, seq: 3, snapshot: msg('public:mat:a:1', 3, 'mat.state') });
    expect(events.map((e) => e.kind)).toEqual(['resync', 'message']);
    expect(events[1]?.kind === 'message' && events[1].message.seq).toBe(4);
  });

  it('a gap resubscribes with the last seq; the snapshot comes as resync', () => {
    const events = listen('public:mat:a:1');
    socket.open();
    socket.answer('public:mat:a:1', { ok: true, seq: 1, snapshot: null });
    socket.fire('message', msg('public:mat:a:1', 2, 'mat.state'));
    socket.fire('message', msg('public:mat:a:1', 5, 'mat.state'));
    expect(socket.lastSubscribe('public:mat:a:1')?.payload).toEqual({
      channel: 'public:mat:a:1',
      lastSeq: 2,
    });
    const snapshot = msg('public:mat:a:1', 5, 'mat.state');
    socket.answer('public:mat:a:1', { ok: true, seq: 5, snapshot });
    expect(events.at(-1)).toEqual({ kind: 'resync', snapshot });
    socket.fire('message', msg('public:mat:a:1', 6, 'mat.state'));
    expect(events.at(-1)?.kind).toBe('message');
  });

  it('a counter reset (smaller seq after the grace period) resyncs', () => {
    const events = listen('ops:x');
    socket.open();
    socket.answer('ops:x', { ok: true, seq: 40, snapshot: null });
    now += 10_000;
    socket.fire('message', msg('ops:x', 1));
    expect(socket.lastSubscribe('ops:x')?.payload).toEqual({ channel: 'ops:x', lastSeq: 40 });
    socket.answer('ops:x', { ok: true, seq: 1, snapshot: null });
    expect(events.filter((e) => e.kind === 'resync')).toHaveLength(2);
  });

  it('nothing missed — no resync after reconnect', () => {
    const events = listen('ops:x');
    socket.open();
    socket.answer('ops:x', { ok: true, seq: 2, snapshot: null });
    socket.fire('disconnect', 'transport close');
    expect(client.status).toBe('offline');
    socket.open();
    expect(socket.lastSubscribe('ops:x')?.payload).toEqual({ channel: 'ops:x', lastSeq: 2 });
    socket.answer('ops:x', { ok: true, seq: 2, snapshot: null });
    expect(events.filter((e) => e.kind === 'resync')).toHaveLength(1);
  });

  it('a refused subscription reports the error; an expired session is refreshed once and reconnects', async () => {
    const events = listen('ops:x');
    socket.open();
    socket.answer('ops:x', { ok: false, error: { code: 'FORBIDDEN' } });
    expect(events).toEqual([{ kind: 'error', code: 'FORBIDDEN' }]);

    const other = listen('ops:y');
    socket.answer('ops:y', { ok: false, error: { code: 'TOKEN_EXPIRED' } });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(socket.connects).toBe(1);
    expect(other).toEqual([]);
    // Второй отказ сразу же — уже не обновление сессии, а ошибка.
    socket.open();
    socket.answer('ops:y', { ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(other).toEqual([{ kind: 'error', code: 'UNAUTHENTICATED' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the server telling that the session expired triggers a refresh', async () => {
    listen('ops:x');
    socket.open();
    socket.fire('expired');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(socket.connects).toBe(1);
  });

  it('retries a subscription without an answer', () => {
    listen('ops:x');
    socket.open();
    const count = () => socket.emitted.filter((e) => e.event === 'subscribe').length;
    expect(count()).toBe(1);
    vi.advanceTimersByTime(10_001);
    expect(count()).toBe(2);
  });

  it('reconnects after the server refused the handshake (socket.io-client does not retry it)', () => {
    listen('ops:x');
    socket.active = false;
    socket.fire('connect_error', new Error('handshake'));
    expect(client.status).toBe('offline');
    expect(socket.connects).toBe(0);
    vi.advanceTimersByTime(3_000);
    expect(socket.connects).toBe(1);
    // Ещё отказ — пауза растёт.
    socket.fire('connect_error', new Error('handshake'));
    vi.advanceTimersByTime(3_000);
    expect(socket.connects).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(socket.connects).toBe(2);
    // Обычный обрыв Socket.IO переподключает сам — без лишних попыток.
    socket.active = true;
    socket.fire('connect_error', new Error('transport'));
    vi.advanceTimersByTime(60_000);
    expect(socket.connects).toBe(2);
  });

  it('a transient refusal is retried; a permanent one is not; health follows the channel', () => {
    const events = listen('ops:x');
    listen('ops:forbidden');
    expect(client.channelHealth('ops:x')).toBe('pending');
    socket.open();
    socket.answer('ops:forbidden', { ok: false, error: { code: 'FORBIDDEN' } });
    socket.answer('ops:x', { ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(events).toEqual([{ kind: 'error', code: 'INTERNAL_ERROR' }]);
    expect(client.channelHealth('ops:x')).toBe('down');
    const subscribes = (channel: string) =>
      socket.emitted.filter(
        (e) => e.event === 'subscribe' && (e.payload as { channel: string }).channel === channel,
      ).length;
    vi.advanceTimersByTime(5_001);
    expect(subscribes('ops:x')).toBe(2);
    expect(subscribes('ops:forbidden')).toBe(1);
    socket.answer('ops:x', { ok: true, seq: 3, snapshot: null });
    expect(client.channelHealth('ops:x')).toBe('live');
    expect(client.channelHealth('ops:forbidden')).toBe('down');
    // Без связи канал не работает; после переподключения отказ «нет прав» запрашивается заново.
    socket.fire('disconnect', 'transport close');
    expect(client.channelHealth('ops:x')).toBe('down');
    socket.open();
    expect(subscribes('ops:forbidden')).toBe(2);
  });

  it('estimates the server clock offset from ping', () => {
    listen('ops:x');
    socket.open();
    const ping = socket.emitted.find((e) => e.event === 'ping');
    now += 100;
    (ping?.ack as (r: { serverTime: number }) => void)({ serverTime: 1_000_050 + 5_000 });
    expect(client.offsetMs).toBe(5_000);
    expect(client.serverNow()).toBe(now + 5_000);
  });

  it('unsubscribes the channel when the last listener leaves; a late listener gets the last state', () => {
    const stop = client.subscribe('public:mat:a:1', () => undefined);
    socket.open();
    const snapshot = msg('public:mat:a:1', 7, 'mat.state');
    socket.answer('public:mat:a:1', { ok: true, seq: 7, snapshot });
    const late: LiveEvent[] = [];
    const stopLate = client.subscribe('public:mat:a:1', (e) => late.push(e));
    expect(late).toEqual([{ kind: 'resync', snapshot }]);
    stop();
    expect(socket.emitted.some((e) => e.event === 'unsubscribe')).toBe(false);
    stopLate();
    expect(socket.emitted.find((e) => e.event === 'unsubscribe')?.payload).toEqual({
      channel: 'public:mat:a:1',
    });
  });
});
