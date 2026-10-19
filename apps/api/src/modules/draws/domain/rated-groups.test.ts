import { RATED_GROUP_LETTERS, snakeGroups } from '@sde/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalDrawInput, type DrawParticipant } from './draw-input';
import { computeDrawLayout } from './layout';
import { createPrng } from './prng';
import { ratedSeedOrder } from './rated-groups';

const SEED = '9f86d081884c7d659a2feaa0c55ad015';
const OTHER = 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
const id = (i: number): string => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`;

const athletes = (ratings: number[]): DrawParticipant[] =>
  ratings.map((rating, i) => ({
    entryId: id(i + 1),
    organizationKey: `club-${i % 2}`,
    regionKey: null,
    seedNumber: null,
    rating,
  }));

const rated = (list: DrawParticipant[]) =>
  canonicalDrawInput({ format: 'SPECIAL_GROUP_RATED', separation: [], participants: list });

describe('rated seeding (RatedGroupSeeding)', () => {
  it('seeds by rating: the highest rating is seed 1', () => {
    const list = athletes([150, 260, 200, 230]);
    expect(ratedSeedOrder(list, createPrng(SEED)).map((p) => p.rating)).toEqual([260, 230, 200, 150]);
  });

  it('breaks equal ratings by the draw seed, reproducibly', () => {
    const list = athletes([200, 200, 200, 200, 200, 200]);
    const a = ratedSeedOrder(list, createPrng(SEED)).map((p) => p.entryId);
    expect(ratedSeedOrder(list, createPrng(SEED)).map((p) => p.entryId)).toEqual(a);
    expect(new Set(a).size).toBe(6);
    // Другой seed — другой порядок равных (для 6 участников совпадение крайне маловероятно).
    expect(ratedSeedOrder(list, createPrng(OTHER)).map((p) => p.entryId)).not.toEqual(a);
  });

  it('refuses a participant without a rating', () => {
    const list = [...athletes([200, 210]), { ...athletes([0])[0]!, entryId: id(9), rating: undefined }];
    expect(() => ratedSeedOrder(list, createPrng(SEED))).toThrow(/has no rating/);
  });
});

describe('rated group assignment (RatedGroupAssignment)', () => {
  it('distributes 13 athletes snake-wise into four groups by rating', () => {
    // Рейтинг 300 − i: посев i + 1 — участник i.
    const list = athletes(Array.from({ length: 13 }, (_, i) => 300 - i));
    const layout = computeDrawLayout(rated(list), SEED);
    expect(layout.size).toBe(13);
    expect(layout.separation).toMatchObject({ applicable: false, unmet: 0 });
    const groups = new Map<string, number[]>();
    for (const s of layout.slots) groups.set(s.pool!, [...(groups.get(s.pool!) ?? []), s.seedNumber!]);
    expect(Object.fromEntries(groups)).toEqual({
      A: [1, 8, 9],
      B: [2, 7, 10],
      C: [3, 6, 11],
      D: [4, 5, 12, 13],
    });
    // Позиции идут подгруппа за подгруппой, внутри — по номеру посева; участник — по своему рейтингу.
    expect(layout.slots.map((s) => s.position)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    for (const s of layout.slots) expect(s.entryId).toBe(id(s.seedNumber!));
  });

  it('puts 3–5 athletes into one group A', () => {
    for (const n of [3, 4, 5]) {
      const layout = computeDrawLayout(rated(athletes(Array.from({ length: n }, () => 200))), SEED);
      expect(new Set(layout.slots.map((s) => s.pool))).toEqual(new Set(['A']));
      expect(layout.slots.map((s) => s.seedNumber)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it('for every supported count: everyone once, group sizes differ by at most one, reproducible', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 39 }),
        fc.array(fc.integer({ min: 100, max: 400 }), { minLength: 39, maxLength: 39 }),
        (n, ratings) => {
          const input = rated(athletes(ratings.slice(0, n)));
          const layout = computeDrawLayout(input, SEED);
          expect(computeDrawLayout(input, SEED)).toEqual(layout);
          expect(new Set(layout.slots.map((s) => s.entryId)).size).toBe(n);
          expect(layout.slots.map((s) => s.seedNumber).sort((a, b) => a! - b!)).toEqual(
            Array.from({ length: n }, (_, i) => i + 1),
          );
          const count = n <= 5 ? 1 : n <= 11 ? 2 : n <= 23 ? 4 : 8;
          const sizes = RATED_GROUP_LETTERS.slice(0, count).map(
            (g) => layout.slots.filter((s) => s.pool === g).length,
          );
          expect(sizes).toEqual(snakeGroups(n, count).map((g) => g.length));
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
          // Посев следует рейтингу: у меньшего номера посева рейтинг не ниже.
          const ratingOf = new Map(input.participants.map((p) => [p.entryId, p.rating!]));
          const bySeed = [...layout.slots].sort((a, b) => a.seedNumber! - b.seedNumber!);
          for (let i = 1; i < bySeed.length; i++)
            expect(ratingOf.get(bySeed[i - 1]!.entryId!)!).toBeGreaterThanOrEqual(
              ratingOf.get(bySeed[i]!.entryId!)!,
            );
        },
      ),
      { numRuns: 200 },
    );
  });
});
