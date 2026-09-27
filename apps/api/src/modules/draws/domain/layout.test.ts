import { drawSize, type DrawFormat, DRAW_FORMATS, meetingRound, nextPowerOfTwo } from '@sde/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalDrawInput, type DrawParticipant, drawInputHash, seedingIssues } from './draw-input';
import { computeDrawLayout } from './layout';
import { byePositions, seedOrder, seedPositions } from './seeding';
import { idealMeetingRound } from './separation';

const SEED = '9f86d081884c7d659a2feaa0c55ad015';
const id = (i: number): string => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`;

function participants(
  n: number,
  club: (i: number) => string | null = () => null,
  region: (i: number) => string | null = () => null,
): DrawParticipant[] {
  return Array.from({ length: n }, (_, i) => ({
    entryId: id(i + 1),
    organizationKey: club(i),
    regionKey: region(i),
    seedNumber: null,
  }));
}

const input = (
  format: DrawFormat,
  list: DrawParticipant[],
  separation = ['ORGANIZATION', 'REGION'] as const,
) => canonicalDrawInput({ format, separation: [...separation], participants: list });

const positionsOf = (slots: { position: number; entryId: string | null }[]) =>
  new Map(slots.filter((s) => s.entryId).map((s) => [s.entryId as string, s.position]));

describe('seeding order and BYE positions', () => {
  it('follows the standard order: seeds k and size + 1 − k meet in round 1', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const order = seedOrder(size);
      for (let p = 0; p < size; p += 2) expect((order[p] ?? 0) + (order[p + 1] ?? 0)).toBe(size + 1);
      // Посевы 1 и 2 — в разных половинах, 1–4 — в разных четвертях.
      const pos = seedPositions(size);
      if (size >= 4) expect(meetingRound(pos[0]!, pos[1]!)).toBe(Math.log2(size));
      if (size >= 8)
        for (let a = 0; a < 4; a++)
          for (let b = a + 1; b < 4; b++)
            expect(meetingRound(pos[a]!, pos[b]!)).toBeGreaterThanOrEqual(Math.log2(size) - 1);
    }
  });

  it('gives BYEs to the top seeds, one per first-round pair, spread over halves and quarters', () => {
    expect(byePositions(8, 5)).toEqual([2, 6, 8]);
    for (let n = 2; n <= 64; n++) {
      const size = nextPowerOfTwo(n);
      const byes = byePositions(size, n);
      expect(byes).toHaveLength(size - n);
      const pairs = new Set(byes.map((p) => Math.ceil(p / 2)));
      expect(pairs.size).toBe(byes.length);
      const half = byes.filter((p) => p <= size / 2).length;
      expect(Math.abs(half - (byes.length - half))).toBeLessThanOrEqual(1);
    }
  });
});

describe('draw input', () => {
  it('is canonical: order of participants does not change the hash', () => {
    const list = participants(5, (i) => `club-${i % 2}`);
    const a = input('ROUND_ROBIN', list);
    const b = input('ROUND_ROBIN', [...list].reverse());
    expect(a).toEqual(b);
    expect(drawInputHash(a)).toBe(drawInputHash(b));
    expect(drawInputHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(drawInputHash(input('SINGLE_ELIMINATION', list))).not.toBe(drawInputHash(a));
  });

  it('keeps the separation priority and drops repeats', () => {
    const a = canonicalDrawInput({
      format: 'SINGLE_ELIMINATION',
      separation: ['REGION', 'ORGANIZATION', 'REGION'],
      participants: [],
    });
    expect(a.separation).toEqual(['REGION', 'ORGANIZATION']);
  });

  it('validates seeding against admitted entries', () => {
    const admitted = new Set([id(1), id(2), id(3)]);
    expect(seedingIssues([{ entryId: id(1), seedNumber: 1 }], admitted)).toEqual([]);
    expect(
      seedingIssues(
        [
          { entryId: id(9), seedNumber: 1 },
          { entryId: id(2), seedNumber: 1 },
          { entryId: id(2), seedNumber: 4 },
        ],
        admitted,
      ).map((i) => `${i.path}:${i.code}`),
    ).toEqual([
      'seeding.0.entryId:not_admitted',
      'seeding.1.seedNumber:duplicate',
      'seeding.2.entryId:duplicate',
      'seeding.2.seedNumber:out_of_range',
    ]);
  });
});

describe('draw layout for N = 1…64 in every format', () => {
  for (const format of DRAW_FORMATS)
    it(`${format}: every participant once, BYEs only against athletes, reproducible`, () => {
      for (let n = 1; n <= 64; n++) {
        const list = participants(
          n,
          (i) => `club-${i % 5}`,
          (i) => `region-${i % 3}`,
        );
        const layout = computeDrawLayout(input(format, list), SEED);
        const size = drawSize(format, n);
        expect(layout.size).toBe(size);
        expect(layout.slots.map((s) => s.position)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
        const placed = layout.slots.filter((s) => s.entryId).map((s) => s.entryId);
        expect(new Set(placed).size).toBe(n);
        expect(placed.sort()).toEqual(list.map((p) => p.entryId).sort());
        expect(layout.slots.filter((s) => s.entryId === null)).toHaveLength(size - n);
        if (format !== 'ROUND_ROBIN')
          for (let p = 1; p <= size; p += 2)
            expect(layout.slots[p - 1]?.entryId !== null || layout.slots[p]?.entryId !== null).toBe(true);
        if (format === 'ELIMINATION_WITH_REPECHAGE' && size >= 4)
          for (const s of layout.slots) expect(s.pool).toBe(s.position <= size / 2 ? 'A' : 'B');
        expect(computeDrawLayout(input(format, list), SEED)).toEqual(layout);
      }
    });
});

describe('reproducibility and randomness', () => {
  it('the same input and seed give the same layout; other seeds give other layouts', () => {
    const list = participants(12, (i) => `club-${i % 4}`);
    const inp = input('ELIMINATION_WITH_REPECHAGE', list);
    const base = computeDrawLayout(inp, SEED);
    expect(computeDrawLayout(inp, SEED)).toEqual(base);
    const seeds = [
      '11111111111111111111111111111111',
      '22222222222222222222222222222222',
      'abcdefabcdefabcdefabcdefabcdef12',
    ];
    expect(
      seeds.some((s) => JSON.stringify(computeDrawLayout(inp, s).slots) !== JSON.stringify(base.slots)),
    ).toBe(true);
  });

  it('places seeded athletes on their seed positions', () => {
    const list = participants(11);
    list[4]!.seedNumber = 1;
    list[7]!.seedNumber = 2;
    list[9]!.seedNumber = 3;
    const layout = computeDrawLayout(input('SINGLE_ELIMINATION', list), SEED);
    const pos = positionsOf(layout.slots);
    const bySeed = seedPositions(16);
    expect(pos.get(id(5))).toBe(bySeed[0]);
    expect(pos.get(id(8))).toBe(bySeed[1]);
    expect(pos.get(id(10))).toBe(bySeed[2]);
    // Сильнейшие посевы получают BYE в первом круге.
    for (const seed of [1, 2, 3]) {
      const p = bySeed[seed - 1]!;
      const partner = p % 2 === 1 ? p + 1 : p - 1;
      expect(layout.slots[partner - 1]?.entryId).toBeNull();
    }
  });
});

describe('separation', () => {
  it('puts two athletes of one club into different halves', () => {
    for (const seed of [SEED, '00000000000000000000000000000001', 'ffffffffffffffffffffffffffffffff']) {
      const list = participants(8, (i) => (i < 2 ? 'club-x' : `solo-${i}`));
      const layout = computeDrawLayout(input('ELIMINATION_WITH_REPECHAGE', list), seed);
      const pos = positionsOf(layout.slots);
      expect(meetingRound(pos.get(id(1))!, pos.get(id(2))!)).toBe(3);
      expect(layout.separation.unmet).toBe(0);
    }
  });

  it('spreads four athletes of one club over four quarters of a 16 bracket', () => {
    const list = participants(16, (i) => (i < 4 ? 'club-x' : `solo-${i}`));
    const layout = computeDrawLayout(input('SINGLE_ELIMINATION', list), SEED);
    const pos = positionsOf(layout.slots);
    const quarters = new Set([1, 2, 3, 4].map((i) => Math.ceil(pos.get(id(i))! / 4)));
    expect(quarters.size).toBe(4);
    const group = layout.separation.groups.find((g) => g.value === 'club-x');
    expect(group).toMatchObject({ size: 4, idealRound: 3, achievedRound: 3 });
  });

  it('separates by the second key without breaking the first', () => {
    // Два клуба по двое, все четверо из одного региона, ещё четверо — каждый сам по себе.
    const list = participants(
      8,
      (i) => (i < 2 ? 'club-a' : i < 4 ? 'club-b' : `solo-${i}`),
      (i) => (i < 4 ? 'region-1' : `region-${i}`),
    );
    const layout = computeDrawLayout(input('SINGLE_ELIMINATION', list), SEED);
    expect(layout.separation.unmet).toBe(0);
    const regionGroup = layout.separation.groups.find((g) => g.key === 'REGION');
    expect(regionGroup).toMatchObject({ value: 'region-1', size: 4, idealRound: 2, achievedRound: 2 });
  });

  it('reports separation it cannot achieve instead of failing', () => {
    // Посевы 1 и 4 одного клуба стоят в одной половине сетки на 8.
    const list = participants(8, (i) => (i === 0 || i === 1 ? 'club-x' : `solo-${i}`));
    list[0]!.seedNumber = 1;
    list[1]!.seedNumber = 4;
    const layout = computeDrawLayout(input('SINGLE_ELIMINATION', list), SEED);
    expect(layout.separation.unmet).toBe(1);
    expect(layout.separation.groups[0]).toMatchObject({ idealRound: 3, achievedRound: 2 });
  });

  it('is not applicable to round robin', () => {
    const layout = computeDrawLayout(
      input(
        'ROUND_ROBIN',
        participants(5, () => 'club'),
      ),
      SEED,
    );
    expect(layout.separation).toMatchObject({ applicable: false, groups: [], unmet: 0 });
  });

  it('achieves the ideal for one large club among singles (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 64 }),
        fc.integer({ min: 2, max: 16 }),
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.constantFrom<DrawFormat>('SINGLE_ELIMINATION', 'ELIMINATION_WITH_REPECHAGE'),
        (n, clubSize, bytes, format) => {
          const hex = Buffer.from(bytes).toString('hex');
          fc.pre(!/^0+$/.test(hex));
          const m = Math.min(clubSize, n);
          const list = participants(n, (i) => (i < m ? 'club-x' : `solo-${i}`));
          const layout = computeDrawLayout(input(format, list), hex);
          const group = layout.separation.groups.find((g) => g.value === 'club-x');
          if (m < 2) return;
          const rounds = Math.log2(layout.size);
          expect(group?.idealRound).toBe(idealMeetingRound(rounds, m));
          // В каждой паре первого круга не больше одного BYE, поэтому идеал достижим и с BYE.
          expect(group?.achievedRound).toBe(group?.idealRound);
        },
      ),
      { numRuns: 150 },
    );
  });
});
