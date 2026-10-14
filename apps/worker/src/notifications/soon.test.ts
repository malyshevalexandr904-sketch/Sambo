import { describe, expect, it } from 'vitest';
import { renderPush } from './push-templates';
import { dueSoon, SOON_WINDOW_MS, type SoonQueueItem, sourceKey } from './soon';

const NOW = Date.parse('2026-10-14T09:00:00.000Z');
const MIN = 60_000;

const item = (n: number, p: Partial<SoonQueueItem> = {}): SoonQueueItem => ({
  matchId: `m${n}`,
  plannedAt: NOW + n * 6 * MIN,
  orderInMat: n,
  status: 'SCHEDULED',
  paired: true,
  withdrawn: false,
  ...p,
});

const ids = (due: { matchId: string; ahead: number }[]) => due.map((d) => `${d.matchId}:${d.ahead}`);

describe('dueSoon', () => {
  it('announces bouts with at most N bouts ahead on the mat, counting the running one', () => {
    const queue = [item(0, { status: 'IN_PROGRESS' }), item(1), item(2), item(3), item(4), item(5)];
    expect(ids(dueSoon(queue, 3, NOW))).toEqual(['m1:1', 'm2:2', 'm3:3']);
    expect(ids(dueSoon(queue, 1, NOW))).toEqual(['m1:1']);
    // 0 — уведомления выключены.
    expect(dueSoon(queue, 0, NOW)).toEqual([]);
  });

  it('a called bout is ahead of everything; the called bout itself is not announced', () => {
    const queue = [item(1), item(2, { status: 'READY' }), item(3)];
    expect(ids(dueSoon(queue, 1, NOW))).toEqual(['m1:1']);
    expect(ids(dueSoon(queue, 2, NOW))).toEqual(['m1:1', 'm3:2']);
  });

  it('bouts waiting for a pair from another mat neither hold the mat nor get announced', () => {
    const queue = [item(1, { paired: false }), item(2), item(3)];
    expect(ids(dueSoon(queue, 1, NOW))).toEqual(['m2:0', 'm3:1']);
  });

  it('skips withdrawn athletes and bouts beyond the 2-hour window', () => {
    const queue = [item(1, { withdrawn: true }), item(2), item(3, { plannedAt: NOW + SOON_WINDOW_MS + MIN })];
    expect(ids(dueSoon(queue, 5, NOW))).toEqual(['m2:1']);
  });
});

describe('sourceKey', () => {
  it('is a stable UUID per parts', () => {
    const k = sourceKey('match.soon', 'abc');
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sourceKey('match.soon', 'abc')).toBe(k);
    expect(sourceKey('match.soon', 'abd')).not.toBe(k);
  });
});

describe('push texts', () => {
  const ctx = {
    competitionName: 'Кубок ковра',
    matNumber: '2',
    matchNumber: '14',
    plannedAt: '2026-10-14T11:30:00.000Z',
    timezone: 'Europe/Moscow',
    athleteName: 'Иванов И.',
  };

  it('show the mat, the bout and how many bouts are ahead — never the child name', () => {
    const soon = renderPush('match.soon', { ...ctx, ahead: '2', locale: 'ru' });
    expect(soon).toEqual({
      title: 'Скоро схватка',
      body: 'Ковёр 2 · через 2 схватки · схватка № 14 · Кубок ковра',
    });
    expect(renderPush('match.soon', { ...ctx, ahead: '1', locale: 'ru' }).body).toContain('через 1 схватку');
    expect(renderPush('match.soon', { ...ctx, ahead: '0', locale: 'ru' }).body).toContain('следующая');
    expect(renderPush('match.time_changed', { ...ctx, locale: 'ru' }).body).toBe(
      'Ковёр 2 · около 14:30 · схватка № 14 · Кубок ковра',
    );
    expect(renderPush('match.started', { ...ctx, locale: 'en' })).toEqual({
      title: 'Bout started',
      body: 'Mat 2 · bout № 14 · Кубок ковра',
    });
    for (const type of ['match.soon', 'match.started', 'match.time_changed', 'results.published'] as const)
      for (const locale of ['ru', 'en'] as const) {
        const t = renderPush(type, { ...ctx, ahead: '1', locale });
        expect(`${t.title} ${t.body}`).not.toContain('Иванов');
      }
  });
});
