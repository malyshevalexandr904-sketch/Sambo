import { RATED_GROUPS_V1, ratedFormatPlan } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import { nodeDependencies } from './dependencies';
import { type BracketState, entryOf, type Outcome } from './graph';
import { finalKey, groupKey } from './rated-groups';
import { isComplete } from './resolve';
import { resolveFormat, strategyFor } from './strategies';

const strategy = strategyFor('SPECIAL_GROUP_RATED')!;
const e = (i: number): string => `e${String(i).padStart(3, '0')}`;
const slots = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, e(i + 1)] as const));

/**
 * Сыграть сетку на n участников до конца: в каждой готовой схватке побеждает участник с меньшей позицией жеребьёвки
 * (e001 — позиция 1), кроме схваток, исход которых задаёт `override`.
 */
function playAll(n: number, override: (key: string) => Outcome | undefined = () => undefined) {
  const graph = strategy.build(n);
  const outcomes = new Map<string, Outcome>();
  let state: BracketState = resolveFormat(strategy, graph, slots(n), outcomes);
  for (let step = 0; step < graph.nodes.length; step++) {
    const ready = graph.nodes.filter((x) => state.get(x.key)?.status === 'READY' && !outcomes.has(x.key));
    if (ready.length === 0) break;
    for (const node of ready) {
      const s = state.get(node.key)!;
      const [red, blue] = [entryOf(s.red)!, entryOf(s.blue)!];
      outcomes.set(node.key, override(node.key) ?? { winner: red < blue ? 'RED' : 'BLUE', method: 'POINTS' });
    }
    state = resolveFormat(strategy, graph, slots(n), outcomes);
  }
  return { graph, state, outcomes, placements: strategy.placements(graph, state, outcomes) };
}

describe('rated groups bracket', () => {
  it('refuses fewer than 3 and more than 39 participants', () => {
    expect(strategy.validate(2)).toBe('not_enough_participants');
    expect(strategy.validate(40)).toBe('too_many_participants');
    for (const n of [3, 5, 6, 11, 12, 23, 24, 39]) expect(strategy.validate(n)).toBeNull();
  });

  it('builds each group by the round schedule of the format version', () => {
    // 13: A 1–3, B 4–6, C 7–9, D 10–13 (позиции жеребьёвки идут подгруппа за подгруппой).
    const graph = strategy.build(13);
    expect(new Set(graph.nodes.flatMap((n) => (n.group ? [n.group] : [])))).toEqual(
      new Set(['A', 'B', 'C', 'D']),
    );
    const d = graph.nodes.filter((n) => n.group === 'D');
    expect(d.map((n) => [n.round, n.red, n.blue])).toEqual(
      RATED_GROUPS_V1.roundSchedules['4']!.flatMap((pairs, r) =>
        pairs.map(([red, blue]) => [
          r + 1,
          { type: 'DRAW_SLOT', position: 9 + red },
          { type: 'DRAW_SLOT', position: 9 + blue },
        ]),
      ),
    );
    expect(graph.nodes.find((n) => n.key === groupKey('A', 3, 1))).toMatchObject({
      stage: 'POOL',
      label: 'ROUND_ROBIN',
      red: { type: 'DRAW_SLOT', position: 3 },
      blue: { type: 'DRAW_SLOT', position: 2 },
    });
  });

  it('has as many group and final matches as the plan, every pair of a group once', () => {
    for (let n = 3; n <= 39; n++) {
      const graph = strategy.build(n);
      const plan = ratedFormatPlan(n);
      if (!plan.ok) throw new Error(`no plan for ${n}`);
      const pool = graph.nodes.filter((x) => x.stage === 'POOL');
      const final = graph.nodes.filter((x) => x.stage === 'FINAL');
      expect([pool.length, final.length]).toEqual([plan.plan.groupMatches, plan.plan.finalMatches]);
      const pairs = pool.map((x) => {
        const [a, b] = [x.red, x.blue].map((s) => (s.type === 'DRAW_SLOT' ? s.position : 0));
        return `${Math.min(a!, b!)}-${Math.max(a!, b!)}`;
      });
      expect(new Set(pairs).size).toBe(pairs.length);
      // Финальная часть: каждый выходящий из подгрупп — ровно один раз в первом круге.
      const refs = final.flatMap((x) =>
        [x.red, x.blue].flatMap((s) => (s.type === 'POOL_RANK' ? [`${s.group}${s.place}`] : [])),
      );
      expect(refs.sort()).toEqual(plan.plan.finalPairing.flat().sort());
    }
  });

  it('pairs the final part by the format version: semifinals for 6–11, quarterfinals for 12–39', () => {
    const six = strategy.build(6).nodes.filter((n) => n.stage === 'FINAL');
    expect(six.map((n) => [n.key, n.label, n.red, n.blue, n.placeForWinner, n.placeForLoser])).toEqual([
      [
        finalKey(1, 1),
        'SEMIFINAL',
        { type: 'POOL_RANK', group: 'A', place: 1 },
        { type: 'POOL_RANK', group: 'B', place: 2 },
        null,
        3,
      ],
      [
        finalKey(1, 2),
        'SEMIFINAL',
        { type: 'POOL_RANK', group: 'B', place: 1 },
        { type: 'POOL_RANK', group: 'A', place: 2 },
        null,
        3,
      ],
      [
        finalKey(2, 1),
        'FINAL',
        { type: 'WINNER_OF', node: finalKey(1, 1) },
        { type: 'WINNER_OF', node: finalKey(1, 2) },
        1,
        2,
      ],
    ]);
    const thirteen = strategy.build(13).nodes.filter((n) => n.stage === 'FINAL');
    expect(thirteen.map((n) => [n.label, n.placeForLoser])).toEqual([
      ['QUARTERFINAL', 5],
      ['QUARTERFINAL', 5],
      ['QUARTERFINAL', 5],
      ['QUARTERFINAL', 5],
      ['SEMIFINAL', 3],
      ['SEMIFINAL', 3],
      ['FINAL', 2],
    ]);
    const qf = strategy.build(24).nodes.find((n) => n.key === finalKey(1, 4))!;
    expect([qf.red, qf.blue]).toEqual([
      { type: 'POOL_RANK', group: 'G', place: 1 },
      { type: 'POOL_RANK', group: 'H', place: 1 },
    ]);
    // Схватка финальной части ждёт все схватки своих подгрупп.
    const graph = strategy.build(6);
    expect(
      nodeDependencies(
        graph.nodes.find((n) => n.key === finalKey(1, 1))!,
        graph,
      ).sort(),
    ).toEqual(
      graph.nodes
        .filter((n) => n.group)
        .map((n) => n.key)
        .sort(),
    );
  });

  it('fills the final part from complete groups only', () => {
    const graph = strategy.build(6);
    // Подгруппа A (1–3) сыграна, B (4–6) — нет: A1 известен, B2 — нет.
    const outcomes = new Map<string, Outcome>();
    for (const node of graph.nodes.filter((n) => n.group === 'A')) {
      const [r, b] = [node.red, node.blue].map((s) => (s.type === 'DRAW_SLOT' ? s.position : 0));
      outcomes.set(node.key, { winner: r! < b! ? 'RED' : 'BLUE', method: 'POINTS' });
    }
    const state = resolveFormat(strategy, graph, slots(6), outcomes);
    expect(state.get(finalKey(1, 1))).toMatchObject({
      red: { kind: 'ENTRY', entryId: e(1) },
      blue: { kind: 'PENDING' },
      status: 'PENDING',
    });
    expect(state.get(finalKey(1, 2))).toMatchObject({ blue: { kind: 'ENTRY', entryId: e(2) } });
  });

  it('keeps a final side pending while a shared group place needs a decision', () => {
    // Подгруппа A: 1 > 2, 2 > 3, 3 > 1 — все по одной победе, критерии не разделяют: A1 и A2 не определены.
    const { state, placements } = playAll(6, (key) =>
      key === groupKey('A', 2, 1) ? { winner: 'BLUE', method: 'POINTS' } : undefined,
    );
    expect(state.get(finalKey(1, 1))?.red).toEqual({ kind: 'PENDING' });
    expect(state.get(finalKey(1, 2))?.blue).toEqual({ kind: 'PENDING' });
    expect(isComplete(state)).toBe(false);
    expect(placements).toBeNull();
  });

  it('fills the pending final sides once people order the shared place', () => {
    const graph = strategy.build(6);
    const { outcomes } = playAll(6, (key) =>
      key === groupKey('A', 2, 1) ? { winner: 'BLUE', method: 'POINTS' } : undefined,
    );
    const state = resolveFormat(strategy, graph, slots(6), outcomes, new Map([['A', [[e(3), e(1), e(2)]]]]));
    expect(state.get(finalKey(1, 1))?.red).toEqual({ kind: 'ENTRY', entryId: e(3) });
    expect(state.get(finalKey(1, 2))?.blue).toEqual({ kind: 'ENTRY', entryId: e(1) });
  });

  it('places a single group by its table', () => {
    expect(playAll(4).placements?.map((p) => [p.entryId, p.place])).toEqual([
      [e(1), 1],
      [e(2), 2],
      [e(3), 3],
      [e(4), 4],
    ]);
  });

  it('places the final part: 1, 2, two thirds, quarterfinal losers fifth; others without a place', () => {
    // 13: подгруппы A 1–3, B 4–6, C 7–9, D 10–13; побеждает меньшая позиция. Четвертьфиналы A1–B2 (1–5), C1–D2
    // (7–11), B1–A2 (4–2), D1–C2 (10–8); полуфиналы 1–7, 2–8; финал 1–2.
    const { state, placements } = playAll(13);
    expect(isComplete(state)).toBe(true);
    expect(placements?.map((p) => [p.entryId, p.place, p.wins, p.losses])).toEqual([
      [e(1), 1, 5, 0],
      [e(2), 2, 3, 2],
      [e(7), 3, 3, 1],
      [e(8), 3, 2, 2],
      [e(4), 5, 2, 1],
      [e(5), 5, 1, 2],
      [e(10), 5, 3, 1],
      [e(11), 5, 2, 2],
    ]);
  });

  it('every athlete plays in exactly one group and at most once per final round', () => {
    for (let n = 3; n <= 39; n++) {
      const { graph, state, placements } = playAll(n);
      expect(isComplete(state)).toBe(true);
      const groupOf = new Map<string, string>();
      for (const node of graph.nodes.filter((x) => x.group)) {
        const s = state.get(node.key)!;
        for (const id of [entryOf(s.red), entryOf(s.blue)]) {
          expect(groupOf.get(id!) ?? node.group).toBe(node.group);
          groupOf.set(id!, node.group!);
        }
      }
      expect(groupOf.size).toBe(n);
      for (const round of new Set(graph.nodes.filter((x) => x.stage === 'FINAL').map((x) => x.round))) {
        const ids = graph.nodes
          .filter((x) => x.stage === 'FINAL' && x.round === round)
          .flatMap((x) => [entryOf(state.get(x.key)!.red), entryOf(state.get(x.key)!.blue)]);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(placements?.[0]).toMatchObject({ entryId: e(1), place: 1 });
      expect(new Set(placements?.map((p) => p.entryId)).size).toBe(placements?.length);
    }
  });
});
