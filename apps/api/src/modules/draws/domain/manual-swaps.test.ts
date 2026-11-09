import { describe, expect, it } from 'vitest';
import { applySwaps, parseSwaps } from './manual-swaps';

const slots = [
  { position: 1, entryId: 'a', seedNumber: 1, pool: 'A' },
  { position: 2, entryId: 'b', seedNumber: null, pool: 'A' },
  { position: 3, entryId: null, seedNumber: null, pool: 'B' },
];

describe('manual draw swaps', () => {
  it('swaps participants and seeds, pools stay with positions', () => {
    const r = applySwaps(slots, [{ a: 1, b: 3 }]);
    expect(r[0]).toEqual({ position: 1, entryId: null, seedNumber: null, pool: 'A' });
    expect(r[2]).toEqual({ position: 3, entryId: 'a', seedNumber: 1, pool: 'B' });
    expect(slots[0]?.entryId).toBe('a');
  });

  it('applies swaps in order and skips unknown positions', () => {
    const r = applySwaps(slots, [
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 7, b: 1 },
    ]);
    expect(r.map((s) => s.entryId)).toEqual(['b', null, 'a']);
  });

  it('parses stored JSON defensively', () => {
    expect(parseSwaps([{ a: 1, b: 2 }, { a: 1, b: 1 }, 'x', { a: '1', b: 2 }])).toEqual([{ a: 1, b: 2 }]);
    expect(parseSwaps(null)).toEqual([]);
  });
});
