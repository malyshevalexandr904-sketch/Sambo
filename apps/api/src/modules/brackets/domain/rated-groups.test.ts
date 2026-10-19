import { RATED_GROUPS_V1, ratedFormatPlan } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import type { BracketState, Outcome } from './graph';
import { groupKey } from './rated-groups';
import { resolveFormat, strategyFor } from './strategies';

const strategy = strategyFor('SPECIAL_GROUP_RATED')!;
const e = (i: number): string => `e${String(i).padStart(3, '0')}`;
const slots = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, e(i + 1)] as const));

describe('rated groups bracket', () => {
  it('refuses fewer than 3 and more than 39 participants', () => {
    expect(strategy.validate(2)).toBe('not_enough_participants');
    expect(strategy.validate(40)).toBe('too_many_participants');
    for (const n of [3, 5, 6, 11, 12, 23, 24, 39]) expect(strategy.validate(n)).toBeNull();
  });

  it('builds each group by the round schedule of the format version', () => {
    // 13: A 1–3, B 4–6, C 7–9, D 10–13 (позиции жеребьёвки идут подгруппа за подгруппой).
    const graph = strategy.build(13);
    expect(new Set(graph.nodes.map((n) => n.group))).toEqual(new Set(['A', 'B', 'C', 'D']));
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

  it('has as many group matches as the plan, every pair of a group once', () => {
    for (let n = 3; n <= 39; n++) {
      const graph = strategy.build(n);
      const plan = ratedFormatPlan(n);
      expect(plan.ok && plan.plan.groupMatches).toBe(graph.nodes.length);
      const pairs = graph.nodes.map((x) => {
        const [a, b] = [x.red, x.blue].map((s) => (s.type === 'DRAW_SLOT' ? s.position : 0));
        return `${Math.min(a!, b!)}-${Math.max(a!, b!)}`;
      });
      expect(new Set(pairs).size).toBe(pairs.length);
    }
  });

  it('places a single group by the round-robin rules; several groups wait for the final part', () => {
    const play = (n: number) => {
      const graph = strategy.build(n);
      const outcomes = new Map<string, Outcome>();
      // Побеждает меньшая позиция (высший посев).
      for (const node of graph.nodes) {
        const [r, b] = [node.red, node.blue].map((s) => (s.type === 'DRAW_SLOT' ? s.position : 0));
        outcomes.set(node.key, { winner: r! < b! ? 'RED' : 'BLUE', method: 'POINTS' });
      }
      const state: BracketState = resolveFormat(strategy, graph, slots(n), outcomes);
      return strategy.placements(graph, state, outcomes);
    };
    expect(play(4)?.map((p) => [p.entryId, p.place])).toEqual([
      [e(1), 1],
      [e(2), 2],
      [e(3), 3],
      [e(4), 4],
    ]);
    expect(play(6)).toBeNull();
  });
});
