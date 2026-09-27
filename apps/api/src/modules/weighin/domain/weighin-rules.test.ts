import { describe, expect, it } from 'vitest';
import {
  allowedAttemptKinds,
  type AttemptFact,
  type DerivationContext,
  deriveWeighIn,
  overlappingWindow,
  windowOpen,
} from './weighin-rules';

const t0 = new Date('2026-11-14T08:00:00Z');
const at = (min: number): Date => new Date(t0.getTime() + min * 60_000);

const attempt = (over: Partial<AttemptFact> & Pick<AttemptFact, 'id'>): AttemptFact => ({
  kind: 'OFFICIAL',
  result: 'PASSED',
  measuredAt: at(0),
  weightGrams: 37_500,
  categoryId: 'm38',
  toleranceGrams: 0,
  ...over,
});

const ctx = (over: Partial<DerivationContext> = {}): DerivationContext => ({
  categoryId: 'm38',
  limits: { kind: 'UP_TO', lowerGrams: 35_000, upperGrams: 38_000 },
  outcome: 'RECHECK',
  recheckPossible: true,
  ...over,
});

describe('weigh-in outcome (D-06)', () => {
  it('no official attempts — expected; a control attempt alone does not decide', () => {
    expect(deriveWeighIn([], ctx())).toEqual({ status: 'EXPECTED', lastAttemptId: null, decisive: null });
    expect(deriveWeighIn([attempt({ id: 'c', kind: 'CONTROL', result: 'FAILED' })], ctx()).status).toBe(
      'EXPECTED',
    );
  });

  it('a failed official attempt requires a recheck while a window is still open, then the recheck decides', () => {
    const failed = attempt({ id: 'a1', result: 'FAILED', weightGrams: 38_200 });
    expect(deriveWeighIn([failed], ctx()).status).toBe('RECHECK_REQUIRED');
    expect(deriveWeighIn([failed], ctx({ recheckPossible: false })).status).toBe('FAILED');
    const passed = attempt({ id: 'a2', kind: 'RECHECK', measuredAt: at(30), weightGrams: 38_000 });
    expect(deriveWeighIn([failed, passed], ctx())).toMatchObject({ status: 'PASSED', lastAttemptId: 'a2' });
    const failedAgain = attempt({ id: 'a3', kind: 'RECHECK', result: 'FAILED', measuredAt: at(30) });
    expect(deriveWeighIn([failed, failedAgain], ctx()).status).toBe('FAILED');
  });

  it('withdrawal and transfer outcomes fail at once; after a transfer the weight is judged by the new category', () => {
    const failed = attempt({ id: 'a1', result: 'FAILED', weightGrams: 40_000 });
    expect(deriveWeighIn([failed], ctx({ outcome: 'WITHDRAW' })).status).toBe('FAILED');
    expect(deriveWeighIn([failed], ctx({ outcome: 'TRANSFER' })).status).toBe('FAILED');
    const moved = ctx({
      outcome: 'TRANSFER',
      categoryId: 'm38plus',
      limits: { kind: 'ABOVE', lowerGrams: 38_000, upperGrams: null },
    });
    expect(deriveWeighIn([failed], moved)).toMatchObject({
      status: 'PASSED',
      decisive: { result: 'PASSED' },
    });
  });

  it('a failed control weighing after a passed official one requires a recheck', () => {
    const ok = attempt({ id: 'a1' });
    const control = attempt({ id: 'c1', kind: 'CONTROL', result: 'FAILED', measuredAt: at(60) });
    expect(deriveWeighIn([ok, control], ctx()).status).toBe('RECHECK_REQUIRED');
    expect(deriveWeighIn([ok, control], ctx({ recheckPossible: false })).status).toBe('FAILED');
    const recheck = attempt({ id: 'r1', kind: 'RECHECK', measuredAt: at(90) });
    expect(deriveWeighIn([ok, control, recheck], ctx())).toMatchObject({
      status: 'PASSED',
      lastAttemptId: 'r1',
    });
    const earlyControl = attempt({ id: 'c0', kind: 'CONTROL', result: 'FAILED', measuredAt: at(-10) });
    expect(deriveWeighIn([earlyControl, ok], ctx()).status).toBe('PASSED');
  });

  it('allowed attempt kinds follow the status', () => {
    expect(allowedAttemptKinds('EXPECTED')).toEqual(['OFFICIAL']);
    expect(allowedAttemptKinds('RECHECK_REQUIRED')).toEqual(['RECHECK']);
    expect(allowedAttemptKinds('PASSED')).toEqual(['CONTROL']);
    expect(allowedAttemptKinds('FAILED')).toEqual([]);
  });
});

describe('weigh-in windows', () => {
  const w = (
    id: string,
    from: number,
    to: number,
    categoryIds: string[],
    kind: 'OFFICIAL' | 'CONTROL' = 'OFFICIAL',
  ) => ({
    id,
    kind,
    startsAt: at(from),
    endsAt: at(to),
    categoryIds,
  });

  it('windows of the same kind overlap only in time and by a shared category', () => {
    const existing = [w('a', 0, 60, ['m35', 'm38']), w('b', 120, 180, ['m38'])];
    expect(overlappingWindow(w('x', 30, 90, ['m38']), existing)?.id).toBe('a');
    expect(overlappingWindow(w('x', 60, 120, ['m38']), existing)).toBeNull();
    expect(overlappingWindow(w('x', 30, 90, ['f34']), existing)).toBeNull();
    expect(overlappingWindow(w('x', 30, 90, ['m38'], 'CONTROL'), existing)).toBeNull();
    expect(overlappingWindow(w('a', 10, 50, ['m38']), existing)).toBeNull();
  });

  it('a window is open from its start inclusive to its end exclusive', () => {
    const win = w('a', 0, 60, []);
    expect(windowOpen(win, at(-1))).toBe(false);
    expect(windowOpen(win, at(0))).toBe(true);
    expect(windowOpen(win, at(59))).toBe(true);
    expect(windowOpen(win, at(60))).toBe(false);
  });
});
