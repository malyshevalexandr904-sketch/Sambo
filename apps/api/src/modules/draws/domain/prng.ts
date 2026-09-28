// Детерминированный генератор жеребьёвки (ARCHITECTURE.md, 14.5): xoshiro128** (Blackman, Vigna).
// Состояние — 128 бит `randomSeed` как есть (четыре слова big-endian): повтор жеребьёвки проверяется любым,
// у кого есть seed и вход. Math.random() в модуле запрещён — только этот генератор.

/** 128 бит в hex, нижний регистр. Нулевое состояние у xoshiro недопустимо. */
export const RANDOM_SEED_PATTERN = /^[0-9a-f]{32}$/;

export function isValidRandomSeed(seed: string): boolean {
  return RANDOM_SEED_PATTERN.test(seed) && !/^0+$/.test(seed);
}

export interface Prng {
  /** Следующее 32-битное беззнаковое значение. */
  nextUint32(): number;
  /** Равномерное целое в [0, bound): отбраковка без смещения распределения. */
  nextInt(bound: number): number;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export function createPrng(seed: string): Prng {
  if (!isValidRandomSeed(seed)) throw new Error('Invalid random seed');
  let s0 = parseInt(seed.slice(0, 8), 16) >>> 0;
  let s1 = parseInt(seed.slice(8, 16), 16) >>> 0;
  let s2 = parseInt(seed.slice(16, 24), 16) >>> 0;
  let s3 = parseInt(seed.slice(24, 32), 16) >>> 0;

  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  const nextInt = (bound: number): number => {
    if (!Number.isInteger(bound) || bound < 1 || bound > 2 ** 32) throw new Error('Invalid bound');
    const limit = Math.floor(2 ** 32 / bound) * bound;
    for (;;) {
      const r = nextUint32();
      if (r < limit) return r % bound;
    }
  };

  return { nextUint32, nextInt };
}

/** Перемешивание Фишера — Йейтса на генераторе: новая последовательность, исходная не меняется. */
export function shuffle<T>(items: readonly T[], prng: Prng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = prng.nextInt(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
