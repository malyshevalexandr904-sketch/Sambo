import type { LiveMatchDto, PublicMatStateDto } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import { mergeMatState, scoreboardView, upNext } from './scoreboard-state';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');

const match = (p: Partial<LiveMatchDto>): LiveMatchDto => ({
  publicId: 'm1',
  number: 1,
  roundLabel: 'FINAL',
  category: { ru: 'Юноши', en: 'Boys' },
  status: 'IN_PROGRESS',
  red: { name: 'Иванов И.', hidden: false, club: 'СК', region: null },
  blue: { name: null, hidden: true, club: 'СШ', region: null },
  score: null,
  clock: null,
  hold: null,
  result: null,
  finishedAt: null,
  version: 3,
  seq: 5,
  ...p,
});

const state = (p: Partial<PublicMatStateDto>): PublicMatStateDto => ({
  competition: { slug: 'cup', name: 'Кубок', timezone: 'Europe/Moscow' },
  mat: { id: 'mat', number: 1, name: null },
  channel: 'public:mat:cup:1',
  current: null,
  last: null,
  next: null,
  serverTime: new Date(NOW).toISOString(),
  ...p,
});

describe('mergeMatState', () => {
  it('keeps the newer state of the same match when an older one arrives late', () => {
    const shown = state({ current: match({ seq: 7 }) });
    const late = state({ current: match({ seq: 6 }), next: match({ publicId: 'm2', status: 'SCHEDULED' }) });
    const merged = mergeMatState(shown, late);
    expect(merged.current?.seq).toBe(7);
    expect(merged.next?.publicId).toBe('m2');
    expect(mergeMatState(shown, state({ current: match({ version: 4, seq: 0 }) })).current?.version).toBe(4);
    expect(
      mergeMatState(shown, state({ current: match({ publicId: 'm9', seq: 1 }) })).current?.publicId,
    ).toBe('m9');
    expect(mergeMatState(shown, state({})).current).toBeNull();
  });
});

describe('scoreboardView', () => {
  it('shows the bout in progress, then the called pair, the last result, the next pair, or an idle mat', () => {
    expect(scoreboardView(state({ current: match({ status: 'PAUSED' }) }), NOW).kind).toBe('live');
    expect(scoreboardView(state({ current: match({ status: 'READY' }) }), NOW).kind).toBe('called');
    const last = match({ status: 'FINISHED', finishedAt: new Date(NOW - 5 * 60_000).toISOString() });
    expect(scoreboardView(state({ last, next: match({ publicId: 'm2' }) }), NOW).kind).toBe('result');
    const old = match({ status: 'FINISHED', finishedAt: new Date(NOW - 2 * 3600_000).toISOString() });
    expect(scoreboardView(state({ last: old, next: match({ publicId: 'm2' }) }), NOW).kind).toBe('next');
    expect(scoreboardView(state({}), NOW).kind).toBe('idle');
  });

  it('shows the next pair in the bottom strip unless it is already on screen', () => {
    const next = match({ publicId: 'm2', status: 'SCHEDULED' });
    const s = state({ current: match({}), next });
    expect(upNext(s, scoreboardView(s, NOW))?.publicId).toBe('m2');
    const onlyNext = state({ next });
    expect(upNext(onlyNext, scoreboardView(onlyNext, NOW))).toBeNull();
  });
});
