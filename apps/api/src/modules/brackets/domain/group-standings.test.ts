import { RATED_GROUPS_V1, type WinMethod } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import type { Outcome, Side } from './graph';
import { groupStandings } from './group-standings';
import { ratedPlacements } from './rated-groups';
import { resolveFormat, strategyFor } from './strategies';

const strategy = strategyFor('SPECIAL_GROUP_RATED')!;
const e = (i: number): string => `e${String(i).padStart(3, '0')}`;
const RULES = RATED_GROUPS_V1.groupStandingRules;

/**
 * Подгруппа(ы) из n участников: исход каждой пары позиций задаёт result(a, b) — победитель-позиция и способ;
 * undefined — схватка ещё не проведена.
 */
function run(n: number, result: (a: number, b: number) => [number, WinMethod, number?, number?] | undefined) {
  const graph = strategy.build(n);
  const slots = new Map(Array.from({ length: n }, (_, i) => [i + 1, e(i + 1)] as const));
  const outcomes = new Map<string, Outcome>();
  for (const node of graph.nodes) {
    const [red, blue] = [node.red, node.blue].map((s) => (s.type === 'DRAW_SLOT' ? s.position : 0)) as [
      number,
      number,
    ];
    const r = result(Math.min(red, blue), Math.max(red, blue));
    if (!r) continue;
    const [winner, method, winnerScore = 0, loserScore = 0] = r;
    const side: Side = winner === red ? 'RED' : 'BLUE';
    outcomes.set(node.key, {
      winner: side,
      method,
      redScore: side === 'RED' ? winnerScore : loserScore,
      blueScore: side === 'BLUE' ? winnerScore : loserScore,
    });
  }
  const state = resolveFormat(strategy, graph, slots, outcomes);
  return { graph, state, outcomes };
}

const table = (n: number, result: Parameters<typeof run>[1], qualifiers = 2, rules = RULES) => {
  const { graph, state, outcomes } = run(n, result);
  return groupStandings(graph, state, outcomes, rules, qualifiers);
};

describe('group standings (GroupStandingsService)', () => {
  it('orders by wins, counts matches, points and qualifiers once the group is complete', () => {
    // 6 участников — подгруппы A (1–3) и B (4–6); меньшая позиция побеждает по баллам 4:1.
    const [a, b] = table(6, (x) => [x, 'POINTS', 4, 1]);
    expect(a!.group).toBe('A');
    expect(a!.complete).toBe(true);
    expect(
      a!.rows.map((r) => [r.entryId, r.position, r.matches, r.wins, r.losses, r.points, r.qualified]),
    ).toEqual([
      [e(1), 1, 2, 2, 0, 8, true],
      [e(2), 2, 2, 1, 1, 5, true],
      [e(3), 3, 2, 0, 2, 2, false],
    ]);
    expect(b!.rows.map((r) => r.entryId)).toEqual([e(4), e(5), e(6)]);
  });

  it('does not decide qualifiers before every group match is decided', () => {
    const [a] = table(6, (x, y) => (x === 1 && y === 2 ? undefined : [x, 'POINTS']));
    expect(a!.complete).toBe(false);
    expect(a!.decisionRequired).toBe(false);
    expect(a!.rows.every((r) => r.qualified === null)).toBe(true);
  });

  it('breaks equal wins by head-to-head', () => {
    // Подгруппа A из 4 (позиции 1–4 при 8 участниках): 2>1, 1>3, 1>4, 2>4, 3>2, 4>3 — у 1 и 2 по 2 победы,
    // у 3 и 4 по одной; личные встречи: 2 выше 1, 4 выше 3.
    const winners: Record<string, number> = { '1-2': 2, '1-3': 1, '1-4': 1, '2-3': 3, '2-4': 2, '3-4': 4 };
    const [a] = table(8, (x, y) => [winners[`${x}-${y}`]!, 'POINTS']);
    expect(a!.rows.map((r) => [r.entryId, r.position, r.wins, r.headToHeadWins])).toEqual([
      [e(2), 1, 2, 1],
      [e(1), 2, 2, 0],
      [e(4), 3, 1, 1],
      [e(3), 4, 1, 0],
    ]);
  });

  it('counts a no-show, withdrawal, injury or disqualification as a clean win', () => {
    // Круг 1>2>3>1 в подгруппе из 3: равны по победам и личным встречам; у 3 — победа неявкой.
    const [a] = table(6, (x, y) => {
      if (x === 1 && y === 3) return [3, 'NO_SHOW'];
      return [x, 'POINTS'];
    });
    // У 3 — чистая победа (неявка): первое место; 1 и 2 снова сравниваются с первого критерия — личная встреча.
    expect(a!.rows.map((r) => [r.entryId, r.position, r.cleanWins])).toEqual([
      [e(3), 1, 1],
      [e(1), 2, 0],
      [e(2), 3, 0],
    ]);
    expect(a!.decisionRequired).toBe(false);
    expect(a!.rows.map((r) => r.qualified)).toEqual([true, true, false]);
  });

  it('shares the place when no criterion separates the athletes', () => {
    const [a] = table(6, (x, y) => (x === 1 && y === 3 ? [3, 'POINTS'] : [x, 'POINTS']));
    expect(a!.rows.map((r) => r.position)).toEqual([1, 1, 1]);
    expect(a!.decisionRequired).toBe(true);
    // Без общего места на границе решение не нужно: выходят все трое при выходе трёх.
    const [whole] = table(6, (x, y) => (x === 1 && y === 3 ? [3, 'POINTS'] : [x, 'POINTS']), 3);
    expect(whole!.decisionRequired).toBe(false);
    expect(whole!.rows.every((r) => r.qualified === true)).toBe(true);
  });

  it('applies only the configured criteria, in order', () => {
    const result: Parameters<typeof run>[1] = (x, y) => (x === 1 && y === 3 ? [3, 'NO_SHOW'] : [x, 'POINTS']);
    const [a] = table(6, result, 2, { criteria: ['WINS'], confirmed: false });
    expect(a!.rows.map((r) => r.position)).toEqual([1, 1, 1]);
  });

  it('places a single group (3–5) by its table', () => {
    const { graph, state, outcomes } = run(3, (x, y) =>
      x === 1 && y === 3 ? [3, 'NO_SHOW'] : [x, 'POINTS'],
    );
    expect(ratedPlacements(graph, state, outcomes)?.map((p) => [p.entryId, p.place])).toEqual([
      [e(3), 1],
      [e(1), 2],
      [e(2), 3],
    ]);
    // Финальной части нет — выход в неё не отмечается и решения не требует.
    const [only] = groupStandings(graph, state, outcomes, RULES, 0);
    expect(only).toMatchObject({ complete: true, decisionRequired: false });
    expect(only!.rows.every((r) => r.qualified === null)).toBe(true);
    const unfinished = run(3, (x, y) => (x === 1 && y === 2 ? undefined : [x, 'POINTS']));
    expect(ratedPlacements(unfinished.graph, unfinished.state, unfinished.outcomes)).toBeNull();
  });
});
