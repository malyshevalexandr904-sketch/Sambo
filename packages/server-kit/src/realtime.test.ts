import type { LiveMessage } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import {
  LIVE_REDIS_CHANNEL,
  LIVE_RETAIN_SECONDS,
  LivePublisher,
  liveLastKey,
  liveSeqKey,
  parseLiveRedisMessage,
} from './realtime.js';

/** Подмена Redis: исполняет «скрипт» на JS так же, как Lua-скрипт публикации. */
class FakeRedis {
  seq = new Map<string, number>();
  last = new Map<string, string>();
  published: { channel: string; body: string }[] = [];
  async eval(_script: string, _n: number, ...args: (string | number)[]): Promise<unknown> {
    const [seqKey, lastKey, head, tail, , retain, channel, room] = args.map(String) as string[];
    const seq = (this.seq.get(seqKey as string) ?? 0) + 1;
    this.seq.set(seqKey as string, seq);
    const msg = `${head}${seq}${tail}`;
    if (retain !== '0') this.last.set(lastKey as string, msg);
    this.published.push({ channel: channel as string, body: `${room}\n${msg}` });
    return seq;
  }
}

describe('LivePublisher', () => {
  it('builds a valid envelope with monotonic seq per room', async () => {
    const redis = new FakeRedis();
    const pub = new LivePublisher(redis);
    expect(await pub.publish({ channel: 'ops:mat:x', type: 'changed', payload: { a: 'й"\n' } })).toBe(1);
    expect(await pub.publish({ channel: 'ops:mat:x', type: 'changed', payload: { a: 2 } })).toBe(2);
    expect(await pub.publish({ channel: 'user', room: 'user:u1', type: 'notification', payload: {} })).toBe(
      1,
    );
    const parsed = redis.published.map((p) => {
      expect(p.channel).toBe(LIVE_REDIS_CHANNEL);
      const m = parseLiveRedisMessage(p.body);
      expect(m).not.toBeNull();
      return { room: m?.room, msg: JSON.parse(m?.json ?? '') as LiveMessage };
    });
    expect(parsed[0]?.msg).toMatchObject({ v: 1, channel: 'ops:mat:x', seq: 1, payload: { a: 'й"\n' } });
    expect(parsed[1]?.msg.seq).toBe(2);
    expect(parsed[2]).toMatchObject({ room: 'user:u1', msg: { channel: 'user', seq: 1 } });
    expect(redis.seq.get(liveSeqKey('user:u1'))).toBe(1);
  });

  it('retains the last state only when asked', async () => {
    const redis = new FakeRedis();
    const pub = new LivePublisher(redis);
    await pub.publish({ channel: 'public:mat:a:1', type: 'mat.state', payload: { n: 1 }, retain: true });
    await pub.publish({ channel: 'ops:mat:y', type: 'changed', payload: {} });
    expect(JSON.parse(redis.last.get(liveLastKey('public:mat:a:1')) ?? '{}')).toMatchObject({ seq: 1 });
    expect(redis.last.has(liveLastKey('ops:mat:y'))).toBe(false);
    expect(LIVE_RETAIN_SECONDS).toBeGreaterThan(0);
  });

  it('rejects malformed pub/sub bodies', () => {
    expect(parseLiveRedisMessage('no-newline')).toBeNull();
    expect(parseLiveRedisMessage('\n{}')).toBeNull();
  });
});
