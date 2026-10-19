// Формат рейтингового турнира (docs/RATED_TOURNAMENT_FORMAT.md; ТЗ 22–25, 34–36, 57, 59–61): правила по числу
// участников, распределение змейкой, схемы кругов, финальная часть.
import { describe, expect, it } from 'vitest';
import {
  RATED_GROUPS_V1,
  RatedFormatConfig,
  type RatedFormatPlan,
  ratedFormatPlan,
  snakeGroups,
} from './rated-format.js';

const plan = (n: number): RatedFormatPlan => {
  const r = ratedFormatPlan(n);
  if (!r.ok) throw new Error(`no plan for ${n}`);
  return r.plan;
};
const sizes = (n: number): number[] => plan(n).groups.map((g) => g.size);

describe('rated format rules', () => {
  it('refuses 1–2 and 40+ participants', () => {
    for (const n of [0, 1, 2])
      expect(ratedFormatPlan(n)).toEqual({
        ok: false,
        issue: 'INSUFFICIENT_PARTICIPANTS',
        minParticipants: 3,
        maxParticipants: 39,
      });
    for (const n of [40, 48, 72])
      expect(ratedFormatPlan(n)).toMatchObject({ ok: false, issue: 'TOO_MANY_PARTICIPANTS' });
  });

  it('3–5: one round-robin group, no final part', () => {
    for (const n of [3, 4, 5])
      expect(plan(n)).toMatchObject({
        groups: [{ letter: 'A', size: n, matches: (n * (n - 1)) / 2 }],
        qualifiersPerGroup: 0,
        finalBracketSize: 0,
        finalMatches: 0,
        totalMatches: (n * (n - 1)) / 2,
      });
  });

  it('6–11: two groups, two qualifiers each, final of 4', () => {
    // ТЗ 59: 6 → 3 + 3, по 2 из каждой, финал на 4.
    expect(plan(6)).toMatchObject({
      groups: [
        { letter: 'A', size: 3 },
        { letter: 'B', size: 3 },
      ],
      qualifiersPerGroup: 2,
      finalBracketSize: 4,
      finalPairing: [
        ['A1', 'B2'],
        ['B1', 'A2'],
      ],
      groupMatches: 6,
      finalMatches: 3,
      totalMatches: 9,
    });
    expect([7, 8, 9, 10, 11].map(sizes)).toEqual([
      [3, 4],
      [4, 4],
      [5, 4],
      [5, 5],
      [5, 6],
    ]);
  });

  it('12–23: four groups, two qualifiers each, final of 8', () => {
    // ТЗ 60: 12 → 4 подгруппы по 3, по 2 из каждой, финал на 8.
    expect(plan(12)).toMatchObject({
      groups: [3, 3, 3, 3].map((size) => ({ size })),
      qualifiersPerGroup: 2,
      finalBracketSize: 8,
      finalPairing: [
        ['A1', 'B2'],
        ['C1', 'D2'],
        ['B1', 'A2'],
        ['D1', 'C2'],
      ],
      finalMatches: 7,
    });
    // Лишний участник — той подгруппе, куда его ставит змейка (docs/RATED_TOURNAMENT_FORMAT.md, F4).
    expect(sizes(13)).toEqual([3, 3, 3, 4]);
    expect(sizes(23)).toEqual([5, 6, 6, 6]);
  });

  it('24–39: eight groups, one qualifier each, final of 8', () => {
    // ТЗ 61: 24 → 8 подгрупп по 3, по 1 из каждой.
    expect(plan(24)).toMatchObject({
      groups: Array.from({ length: 8 }, () => ({ size: 3 })),
      qualifiersPerGroup: 1,
      finalBracketSize: 8,
      finalPairing: [
        ['A1', 'B1'],
        ['C1', 'D1'],
        ['E1', 'F1'],
        ['G1', 'H1'],
      ],
    });
    expect(
      plan(39)
        .groups.map((g) => g.size)
        .sort(),
    ).toEqual([4, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('for every supported size: nobody lost or duplicated, groups of 3–6 differing by at most one', () => {
    for (let n = 3; n <= 39; n++) {
      const p = plan(n);
      const seeds = snakeGroups(n, p.groups.length)
        .flat()
        .sort((a, b) => a - b);
      expect(seeds).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      const s = p.groups.map((g) => g.size);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...s)).toBeLessThanOrEqual(6);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      // Финальная часть — ровно все вышедшие, каждый один раз.
      const refs = p.finalPairing.flat();
      expect(refs).toHaveLength(p.finalBracketSize);
      expect(new Set(refs).size).toBe(refs.length);
      expect(p.groups.length * p.qualifiersPerGroup).toBe(p.finalBracketSize);
    }
  });
});

describe('snake distribution', () => {
  it('4 groups: A 1, 8, 9, 16; B 2, 7, 10, 15; C 3, 6, 11, 14; D 4, 5, 12, 13', () => {
    expect(snakeGroups(16, 4)).toEqual([
      [1, 8, 9, 16],
      [2, 7, 10, 15],
      [3, 6, 11, 14],
      [4, 5, 12, 13],
    ]);
  });

  it('8 groups alternate direction every row', () => {
    const g = snakeGroups(32, 8);
    expect(g[0]).toEqual([1, 16, 17, 32]);
    expect(g[7]).toEqual([8, 9, 24, 25]);
  });

  it('the strongest seeds of a half meet only in the final: A1 and B1 are in different halves', () => {
    for (const n of [12, 23]) {
      const pairs = plan(n).finalPairing;
      const half = pairs.length / 2;
      const where = (ref: string) => (pairs.findIndex((p) => p.includes(ref)) < half ? 0 : 1);
      expect(where('A1')).not.toBe(where('B1'));
    }
  });
});

describe('round schedules', () => {
  it('every pair of a group meets exactly once; nobody fights twice in a round', () => {
    for (const [size, rounds] of Object.entries(RATED_GROUPS_V1.roundSchedules)) {
      const n = Number(size);
      const pairs = rounds.flat().map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`));
      expect(new Set(pairs).size).toBe((n * (n - 1)) / 2);
      expect(pairs).toHaveLength((n * (n - 1)) / 2);
    }
    // Схема для 3 — по листу «Схема групп»: 1-2, 1-3, 3-2.
    expect(RATED_GROUPS_V1.roundSchedules['3']).toEqual([[[1, 2]], [[1, 3]], [[3, 2]]]);
  });

  it('the config schema rejects inconsistent rules', () => {
    const base = structuredClone(RATED_GROUPS_V1);
    const gap = { ...base, rules: [base.rules[0]!, base.rules[2]!] };
    expect(RatedFormatConfig.safeParse(gap).error?.issues.map((i) => i.message)).toContain(
      'ranges_not_contiguous',
    );
    const badPairing = structuredClone(base);
    badPairing.rules[1]!.finalPairing = [
      ['A1', 'B2'],
      ['A1', 'A2'],
    ];
    expect(RatedFormatConfig.safeParse(badPairing).error?.issues.map((i) => i.message)).toContain(
      'final_pairing_duplicate',
    );
    const noSchedule = structuredClone(base);
    delete noSchedule.roundSchedules['6'];
    expect(RatedFormatConfig.safeParse(noSchedule).error?.issues.map((i) => i.message)).toContain(
      'schedule_missing_6',
    );
    const brokenSchedule = structuredClone(base);
    brokenSchedule.roundSchedules['3'] = [[[1, 2]], [[1, 2]], [[3, 2]]];
    expect(RatedFormatConfig.safeParse(brokenSchedule).error?.issues.map((i) => i.message)).toContain(
      'schedule_pair_repeated',
    );
  });
});
