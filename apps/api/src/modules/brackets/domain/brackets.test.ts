import { DRAW_FORMATS, type DrawFormat, drawSize, type WinMethod } from '@sde/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainKey } from './elimination';
import { type BracketGraph, type BracketState, loserOf, type Outcome, type Side, winnerOf } from './graph';
import { repechageKey } from './repechage';
import { resolveBracket, type SlotMap } from './resolve';
import { roundRobinPairs } from './round-robin';
import { resolveFormat, strategyFor } from './strategies';

const e = (i: number): string => `e${String(i).padStart(3, '0')}`;

/** Стандартные места BYE (как в жеребьёвке): места посевов n + 1 … size. */
function byePositions(size: number, n: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((seed) => [seed, next + 1 - seed]);
  }
  return order.map((seed, i) => (seed > n ? i + 1 : 0)).filter((p) => p > 0);
}

/** Слоты: участники по порядку, BYE — на стандартных местах (как в жеребьёвке без разведения). */
function slotsFor(format: DrawFormat, n: number): SlotMap {
  const size = drawSize(format, n);
  const byes = new Set(format === 'ROUND_ROBIN' ? [] : byePositions(size, n));
  const slots = new Map<number, string | null>();
  let next = 1;
  for (let p = 1; p <= size; p++) slots.set(p, byes.has(p) ? null : e(next++));
  return slots;
}

interface Run {
  graph: BracketGraph;
  state: BracketState;
  outcomes: Map<string, Outcome>;
  played: number;
}

/** Прогон сетки до конца: готовые узлы решаются выбором choose(ключ узла) → сторона победителя. */
function play(
  format: DrawFormat,
  n: number,
  choose: (key: string) => Side,
  slots = slotsFor(format, n),
): Run {
  const strategy = strategyFor(format)!;
  const graph = strategy.build(drawSize(format, n));
  const outcomes = new Map<string, Outcome>();
  let state = resolveFormat(strategy, graph, slots, outcomes);
  // Готовые узлы решаются пачкой, затем состояние пересчитывается (как подтверждение нескольких схваток подряд).
  for (;;) {
    const ready = graph.nodes.filter((node) => state.get(node.key)?.status === 'READY');
    if (ready.length === 0) break;
    for (const node of ready) outcomes.set(node.key, { winner: choose(node.key), method: 'POINTS' });
    state = resolveFormat(strategy, graph, slots, outcomes);
  }
  return { graph, state, outcomes, played: outcomes.size };
}

const statuses = (state: BracketState) => [...state.values()].map((s) => s.status);

describe('bracket structure for N = 1…64', () => {
  it('single elimination: N − 1 matches, BYEs only in round 1, a final always', () => {
    for (let n = 2; n <= 64; n++) {
      const run = play('SINGLE_ELIMINATION', n, () => 'RED');
      const size = drawSize('SINGLE_ELIMINATION', n);
      expect(run.graph.nodes).toHaveLength(size - 1);
      expect(run.played).toBe(n - 1);
      expect(statuses(run.state).filter((s) => s === 'WALKOVER')).toHaveLength(size - n);
      expect(statuses(run.state)).not.toContain('EMPTY');
      for (const node of run.graph.nodes)
        if (run.state.get(node.key)?.status === 'WALKOVER') expect(node.round).toBe(1);
      const final = run.state.get(mainKey(Math.log2(size), 1));
      expect(final?.status).toBe('DECIDED');
    }
  });

  it('round robin: every pair meets exactly once, nobody twice in a round', () => {
    for (let n = 2; n <= 64; n++) {
      const rounds = roundRobinPairs(n);
      expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
      const pairs = new Set<string>();
      for (const round of rounds) {
        const seen = new Set<number>();
        for (const [a, b] of round) {
          expect(a).not.toBe(b);
          expect(seen.has(a) || seen.has(b)).toBe(false);
          seen.add(a);
          seen.add(b);
          pairs.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
        }
      }
      expect(pairs.size).toBe((n * (n - 1)) / 2);
      expect(play('ROUND_ROBIN', n, () => 'BLUE').played).toBe((n * (n - 1)) / 2);
    }
  });

  it('repechage: main bracket plus 2 × (rounds − 2) repechage nodes', () => {
    for (let n = 2; n <= 64; n++) {
      const size = drawSize('ELIMINATION_WITH_REPECHAGE', n);
      const rounds = Math.log2(size);
      const graph = strategyFor('ELIMINATION_WITH_REPECHAGE')!.build(size);
      expect(graph.nodes.filter((x) => x.stage === 'MAIN')).toHaveLength(size - 1);
      expect(graph.nodes.filter((x) => x.stage === 'REPECHAGE')).toHaveLength(2 * Math.max(0, rounds - 2));
    }
  });

  it('refuses fewer than two participants', () => {
    for (const format of DRAW_FORMATS) {
      expect(strategyFor(format)!.validate(1)).toBe('not_enough_participants');
      expect(strategyFor(format)!.validate(0)).toBe('not_enough_participants');
      expect(strategyFor(format)!.validate(2)).toBeNull();
    }
    expect(strategyFor('DOUBLE_ELIMINATION')).toBeNull();
  });
});

describe('bracket invariants under random results (property)', () => {
  for (const format of DRAW_FORMATS)
    it(`${format}: no self-matches, a single champion, everybody placed`, () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 64 }), fc.infiniteStream(fc.boolean()), (n, coins) => {
          const run = play(format, n, () => (coins.next().value ? 'RED' : 'BLUE'));
          for (const s of run.state.values()) {
            expect(s.status === 'PENDING' || s.status === 'READY').toBe(false);
            if (s.red.kind === 'ENTRY' && s.blue.kind === 'ENTRY')
              expect(s.red.entryId).not.toBe(s.blue.entryId);
          }
          const strategy = strategyFor(format)!;
          const places = strategy.placements(run.graph, run.state, run.outcomes)!;
          expect(places).not.toBeNull();
          expect(places.map((p) => p.entryId).sort()).toEqual(Array.from({ length: n }, (_, i) => e(i + 1)));
          // В круговой системе равенство побед без решающих критериев делит место (и первое).
          if (format === 'ROUND_ROBIN') expect(places.filter((p) => p.place === 1).length).toBeGreaterThan(0);
          else expect(places.filter((p) => p.place === 1)).toHaveLength(1);
          // Место = 1 + число участников выше: деление мест не оставляет «дыр» неверного размера.
          for (const p of places) expect(p.place).toBe(1 + places.filter((q) => q.place < p.place).length);
          const losses = new Map(places.map((p) => [p.entryId, p.losses]));
          if (format !== 'ROUND_ROBIN') {
            const champion = places.find((p) => p.place === 1)!;
            expect(champion.losses).toBe(0);
            expect(places.filter((p) => p.place === 2)).toHaveLength(1);
            const limit = format === 'SINGLE_ELIMINATION' ? 1 : 2;
            for (const l of losses.values()) expect(l).toBeLessThanOrEqual(limit);
            const thirds = places.filter((p) => p.place === 3).length;
            expect(thirds).toBeLessThanOrEqual(2);
            if (n >= 4) expect(thirds).toBeGreaterThanOrEqual(1);
          }
          const played = [...run.state.values()].filter((s) => s.status === 'DECIDED').length;
          const total = places.reduce((acc, p) => acc + p.wins, 0);
          expect(total).toBe(played);
        }),
        { numRuns: 120 },
      );
    });
});

describe('elimination with repechage', () => {
  /** Сетка на 8: e1…e8 по позициям; победу получает участник с меньшим номером, кроме перечисленных исключений. */
  const favourite =
    (run: { state: BracketState }, upsets: Record<string, Side> = {}) =>
    (key: string): Side => {
      if (upsets[key]) return upsets[key];
      const s = run.state.get(key)!;
      const red = s.red.kind === 'ENTRY' ? s.red.entryId : '';
      const blue = s.blue.kind === 'ENTRY' ? s.blue.entryId : '';
      return red < blue ? 'RED' : 'BLUE';
    };

  function playWith(n: number, chooser: (run: { state: BracketState }) => (key: string) => Side): Run {
    const format = 'ELIMINATION_WITH_REPECHAGE';
    const strategy = strategyFor(format)!;
    const slots = new Map<number, string | null>();
    const size = drawSize(format, n);
    const byes = new Set(byePositions(size, n));
    let next = 1;
    for (let p = 1; p <= size; p++) slots.set(p, byes.has(p) ? null : e(next++));
    const graph = strategy.build(size);
    const outcomes = new Map<string, Outcome>();
    const holder = { state: resolveFormat(strategy, graph, slots, outcomes) };
    const choose = chooser(holder);
    for (;;) {
      const ready = graph.nodes.find((node) => holder.state.get(node.key)?.status === 'READY');
      if (!ready) break;
      outcomes.set(ready.key, { winner: choose(ready.key), method: 'POINTS' });
      holder.state = resolveFormat(strategy, graph, slots, outcomes);
    }
    return { graph, state: holder.state, outcomes, played: outcomes.size };
  }

  it('sends the losers to the pool winner into the repechage of their pool (8 athletes)', () => {
    const run = playWith(8, (h) => favourite(h));
    // Подгруппа A: e1 обыграл e2 (1-й круг) и e3 (финал подгруппы); утешительная — e2 против e3.
    const bronzeA = run.state.get(repechageKey('A', 1))!;
    expect(bronzeA.red).toEqual({ kind: 'ENTRY', entryId: e(2) });
    expect(bronzeA.blue).toEqual({ kind: 'ENTRY', entryId: e(3) });
    const bronzeB = run.state.get(repechageKey('B', 1))!;
    expect([bronzeB.red, bronzeB.blue]).toEqual([
      { kind: 'ENTRY', entryId: e(6) },
      { kind: 'ENTRY', entryId: e(7) },
    ]);
    const places = strategyFor('ELIMINATION_WITH_REPECHAGE')!.placements(run.graph, run.state, run.outcomes)!;
    const place = new Map(places.map((p) => [p.entryId, p.place]));
    expect(place.get(e(1))).toBe(1);
    expect(place.get(e(5))).toBe(2);
    expect([place.get(e(2)), place.get(e(6))]).toEqual([3, 3]);
    expect([place.get(e(3)), place.get(e(7))]).toEqual([5, 5]);
    expect([place.get(e(4)), place.get(e(8))]).toEqual([7, 7]);
  });

  it('builds the repechage chain round by round and skips a pool winner’s BYE (16, 13 athletes)', () => {
    // 13 участников в сетке на 16: BYE у позиций 2, 10, 14 (посевы 1–3). e1 на позиции 1 проходит 1-й круг без схватки.
    const run = playWith(13, (h) => favourite(h));
    const winnerA = winnerOf(run.state.get(mainKey(3, 1)));
    expect(winnerA).toBe(e(1));
    // Проигравшего победителю в 1-м круге нет — первая утешительная схватка без соперника.
    const first = run.state.get(repechageKey('A', 1))!;
    expect(first.status).toBe('WALKOVER');
    expect(first.red).toEqual({ kind: 'BYE' });
    const second = run.state.get(repechageKey('A', 2))!;
    // Проигравший e1 во 2-м круге проходит дальше и встречается с проигравшим в финале подгруппы.
    expect(second.red).toEqual(first.blue);
    expect(second.status).toBe('DECIDED');
    const places = strategyFor('ELIMINATION_WITH_REPECHAGE')!.placements(run.graph, run.state, run.outcomes)!;
    expect(places.filter((p) => p.place === 3)).toHaveLength(2);
    expect(places.filter((p) => p.place === 5)).toHaveLength(2);
  });

  it('keeps the repechage pending until the pool final is decided', () => {
    const strategy = strategyFor('ELIMINATION_WITH_REPECHAGE')!;
    const graph = strategy.build(8);
    const slots = slotsFor('ELIMINATION_WITH_REPECHAGE', 8);
    const outcomes = new Map<string, Outcome>([
      [mainKey(1, 1), { winner: 'RED', method: 'POINTS' }],
      [mainKey(1, 2), { winner: 'RED', method: 'POINTS' }],
    ]);
    const state = resolveFormat(strategy, graph, slots, outcomes);
    expect(state.get(repechageKey('A', 1))?.status).toBe('PENDING');
    outcomes.set(mainKey(2, 1), { winner: 'BLUE', method: 'POINTS' });
    const after = resolveFormat(strategy, graph, slots, outcomes);
    // Победитель подгруппы — e3: утешительная — проигравшие ему e4 (1-й круг) и e1 (финал подгруппы).
    expect(after.get(repechageKey('A', 1))).toMatchObject({
      status: 'READY',
      red: { kind: 'ENTRY', entryId: e(4) },
      blue: { kind: 'ENTRY', entryId: e(1) },
    });
  });

  it('gives third places to the pool final losers in a bracket of four', () => {
    const run = playWith(4, (h) => favourite(h));
    const places = strategyFor('ELIMINATION_WITH_REPECHAGE')!.placements(run.graph, run.state, run.outcomes)!;
    expect(places.map((p) => [p.entryId, p.place])).toEqual([
      [e(1), 1],
      [e(3), 2],
      [e(2), 3],
      [e(4), 3],
    ]);
    expect(run.graph.nodes.some((x) => x.stage === 'REPECHAGE')).toBe(false);
  });
});

describe('single elimination places', () => {
  it('shares third places between semi-final losers and fifth between quarter-final losers', () => {
    const run = play('SINGLE_ELIMINATION', 8, () => 'RED');
    const places = strategyFor('SINGLE_ELIMINATION')!.placements(run.graph, run.state, run.outcomes)!;
    const byPlace = (k: number) => places.filter((p) => p.place === k).length;
    expect([byPlace(1), byPlace(2), byPlace(3), byPlace(5)]).toEqual([1, 1, 2, 4]);
    expect(places.find((p) => p.place === 1)).toMatchObject({ entryId: e(1), wins: 3, losses: 0 });
  });
});

describe('round robin places', () => {
  function rr(n: number, results: Record<string, [number, WinMethod]>) {
    const strategy = strategyFor('ROUND_ROBIN')!;
    const graph = strategy.build(n);
    const slots = slotsFor('ROUND_ROBIN', n);
    const outcomes = new Map<string, Outcome>();
    const initial = resolveBracket(graph, slots, new Map());
    for (const node of graph.nodes) {
      const s = initial.get(node.key)!;
      const a = (s.red as { entryId: string }).entryId;
      const b = (s.blue as { entryId: string }).entryId;
      const key = [a, b].sort().join('-');
      const [winner, method] = results[key] ?? [0, 'POINTS'];
      outcomes.set(node.key, { winner: e(winner) === a ? 'RED' : 'BLUE', method });
    }
    const state = resolveBracket(graph, slots, outcomes);
    return strategy.placements(graph, state, outcomes)!;
  }
  const w = (winner: number, method: WinMethod = 'POINTS'): [number, WinMethod] => [winner, method];

  it('ranks by wins, then head-to-head', () => {
    const places = rr(4, {
      [`${e(1)}-${e(2)}`]: w(2),
      [`${e(1)}-${e(3)}`]: w(1),
      [`${e(1)}-${e(4)}`]: w(1),
      [`${e(2)}-${e(3)}`]: w(3),
      [`${e(2)}-${e(4)}`]: w(2),
      [`${e(3)}-${e(4)}`]: w(4),
    });
    // e1 и e2 — по две победы, e2 выиграл личную встречу; у e3 и e4 — по одной, e4 выиграл личную встречу.
    expect(places.map((p) => [p.entryId, p.place])).toEqual([
      [e(2), 1],
      [e(1), 2],
      [e(4), 3],
      [e(3), 4],
    ]);
  });

  it('breaks a three-way tie by the quality of wins, then shares the place', () => {
    const cyclic = (m1: WinMethod, m2: WinMethod, m3: WinMethod) =>
      rr(3, {
        [`${e(1)}-${e(2)}`]: w(1, m1),
        [`${e(2)}-${e(3)}`]: w(2, m2),
        [`${e(1)}-${e(3)}`]: w(3, m3),
      });
    expect(cyclic('TOTAL_VICTORY', 'POINTS', 'SUPERIORITY').map((p) => [p.entryId, p.place])).toEqual([
      [e(1), 1],
      [e(3), 2],
      [e(2), 3],
    ]);
    expect(cyclic('POINTS', 'POINTS', 'POINTS').map((p) => p.place)).toEqual([1, 1, 1]);
  });

  it('is not complete until every match is decided', () => {
    const strategy = strategyFor('ROUND_ROBIN')!;
    const graph = strategy.build(3);
    const state = resolveBracket(graph, slotsFor('ROUND_ROBIN', 3), new Map());
    expect(strategy.placements(graph, state, new Map())).toBeNull();
    expect(winnerOf(state.get(graph.nodes[0]!.key))).toBeNull();
    expect(loserOf(state.get(graph.nodes[0]!.key))).toBeNull();
  });
});
