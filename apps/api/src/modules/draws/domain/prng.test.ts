import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPrng, isValidRandomSeed, shuffle } from './prng';

/** Независимая эталонная реализация xoshiro128** на BigInt — для сверки. */
function reference(seed: bigint[], count: number): number[] {
  const s = [...seed];
  const mask = 0xffffffffn;
  const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (32n - k))) & mask;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const s0 = s[0]!;
    const s1 = s[1]!;
    out.push(Number((rotl((s1 * 5n) & mask, 7n) * 9n) & mask));
    const t = (s1 << 9n) & mask;
    s[2] = s[2]! ^ s0;
    s[3] = s[3]! ^ s1;
    s[1] = s1 ^ s[2];
    s[0] = s0 ^ s[3];
    s[2] = s[2] ^ t;
    s[3] = rotl(s[3], 11n);
  }
  return out;
}

describe('xoshiro128**', () => {
  it('matches the reference sequence for state {1, 2, 3, 4}', () => {
    const prng = createPrng('00000001000000020000000300000004');
    const first = Array.from({ length: 4 }, () => prng.nextUint32());
    // Первые значения эталонной реализации (Blackman, Vigna) для этого состояния.
    expect(first.slice(0, 3)).toEqual([11520, 0, 5927040]);
    expect(first).toEqual(reference([1n, 2n, 3n, 4n], 4));
  });

  it('agrees with the BigInt reference for any seed', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), (bytes) => {
        const hex = Buffer.from(bytes).toString('hex');
        fc.pre(isValidRandomSeed(hex));
        const words = [0, 1, 2, 3].map((i) => BigInt(`0x${hex.slice(i * 8, i * 8 + 8)}`));
        const prng = createPrng(hex);
        const ours = Array.from({ length: 16 }, () => prng.nextUint32());
        expect(ours).toEqual(reference(words, 16));
      }),
    );
  });

  it('rejects malformed and all-zero seeds', () => {
    expect(isValidRandomSeed('0'.repeat(32))).toBe(false);
    expect(isValidRandomSeed('ABCDEF0123456789abcdef0123456789')).toBe(false);
    expect(isValidRandomSeed('abc')).toBe(false);
    expect(() => createPrng('0'.repeat(32))).toThrow();
  });

  it('nextInt stays within bounds and covers the range', () => {
    const prng = createPrng('0123456789abcdef0123456789abcdef');
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const v = prng.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v]! += 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });

  it('shuffle is a deterministic permutation', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle(items, createPrng('fedcba9876543210fedcba9876543210'));
    const b = shuffle(items, createPrng('fedcba9876543210fedcba9876543210'));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
  });
});
