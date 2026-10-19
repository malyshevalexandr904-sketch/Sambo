import type { LiveMessage } from '@sde/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as feed from './public-cache-feed';
import { applyFeedMessage } from './public-cache-feed';

vi.mock('./public-cache-feed', async (orig) => ({
  ...(await orig<typeof feed>()),
  startPublicCacheFeed: vi.fn(),
}));

const { invalidatePublic, publicApi } = await import('./public-api');

const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ url }), { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

async function calls(paths: string[]): Promise<number> {
  fetchMock.mockClear();
  for (const p of paths) await publicApi(p);
  return fetchMock.mock.calls.length;
}

describe('public api cache reset (Phase 8b)', () => {
  const paths = [
    '/competitions/cup-2026',
    '/competitions/cup-2026/categories',
    '/competitions/cup-2026x',
    '/competitions',
  ];
  beforeEach(async () => {
    invalidatePublic(null, []);
    await calls(paths);
  });

  it('serves repeated requests from the cache', async () => {
    expect(await calls(paths)).toBe(0);
  });

  it('a change of one tournament resets only its answers; the list — when the tournament itself changed', async () => {
    invalidatePublic('cup-2026', ['matches']);
    fetchMock.mockClear();
    for (const p of paths) await publicApi(p);
    expect(fetchMock.mock.calls.map((c) => String(c[0]).replace(/^.*\/api\/public\/v1/, ''))).toEqual([
      '/competitions/cup-2026',
      '/competitions/cup-2026/categories',
    ]);
    invalidatePublic('cup-2026', ['competition']);
    expect(await calls(paths)).toBe(3);
    invalidatePublic(null, []);
    expect(await calls(paths)).toBe(4);
  });
});

describe('public api cache reset after a rating calculation (rating phase 13)', () => {
  const paths = [
    '/competitions/cup-2026/rating-summary',
    '/competitions/cup-2026x/rating-summary',
    '/rankings',
    '/rankings/abc123',
    '/athletes/abc123/rating-history',
  ];
  beforeEach(async () => {
    invalidatePublic(null, []);
    await calls(paths);
  });

  it('resets the tournament, the rating table and athlete cards, not other tournaments', async () => {
    invalidatePublic('cup-2026', ['rating']);
    fetchMock.mockClear();
    for (const p of paths) await publicApi(p);
    expect(fetchMock.mock.calls.map((c) => String(c[0]).replace(/^.*\/api\/public\/v1/, ''))).toEqual([
      '/competitions/cup-2026/rating-summary',
      '/rankings',
      '/rankings/abc123',
      '/athletes/abc123/rating-history',
    ]);
    invalidatePublic('cup-2026', ['categories']);
    expect(await calls(paths)).toBe(1);
  });
});

describe('feed messages', () => {
  const msg = (seq: number, payload: unknown): LiveMessage =>
    ({ v: 1, channel: 'public:competitions', seq, type: 'changed', payload }) as LiveMessage;

  it('consecutive messages reset one tournament; a gap or a strange payload resets everything', () => {
    const inv = vi.fn();
    expect(applyFeedMessage(msg(5, { slug: 'a', topics: ['results'] }), 4, inv)).toBe(5);
    expect(inv).toHaveBeenLastCalledWith('a', ['results']);
    applyFeedMessage(msg(9, { slug: 'b', topics: ['results'] }), 5, inv);
    expect(inv).toHaveBeenLastCalledWith(null, []);
    applyFeedMessage(msg(10, { nope: true }), 9, inv);
    expect(inv).toHaveBeenLastCalledWith(null, []);
  });
});
