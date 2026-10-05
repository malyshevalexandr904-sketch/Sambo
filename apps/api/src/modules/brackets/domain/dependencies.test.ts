import { drawSize, eliminationRounds } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import { nodeDependencies, participantsKnownAtPublish } from './dependencies';
import { mainKey } from './elimination';
import { repechageKey } from './repechage';
import { strategyFor } from './strategies';

describe('nodeDependencies (планировщик расписания опирается на эти зависимости)', () => {
  it('круговая система ни от чего не зависит: все участники известны сразу', () => {
    const graph = strategyFor('ROUND_ROBIN')!.build(drawSize('ROUND_ROBIN', 6));
    for (const node of graph.nodes) {
      expect(nodeDependencies(node, graph)).toEqual([]);
      expect(participantsKnownAtPublish(node)).toBe(true);
    }
  });

  it('первый круг олимпийской системы ни от чего не зависит: оба слота — прямые слоты жеребьёвки', () => {
    const graph = strategyFor('SINGLE_ELIMINATION')!.build(drawSize('SINGLE_ELIMINATION', 8));
    for (const node of graph.nodes.filter((n) => n.round === 1)) {
      expect(nodeDependencies(node, graph)).toEqual([]);
      expect(participantsKnownAtPublish(node)).toBe(true);
    }
  });

  it('круг 2+ олимпийской системы зависит от двух узлов предыдущего круга', () => {
    const size = drawSize('SINGLE_ELIMINATION', 8);
    const graph = strategyFor('SINGLE_ELIMINATION')!.build(size);
    const node = graph.nodes.find((n) => n.key === mainKey(2, 1))!;
    expect(nodeDependencies(node, graph).sort()).toEqual([mainKey(1, 1), mainKey(1, 2)]);
    expect(participantsKnownAtPublish(node)).toBe(false);
  });

  it('утешительная схватка шага 1 зависит от финала своей подгруппы, а не от всех схваток круга', () => {
    const n = 16;
    const size = drawSize('ELIMINATION_WITH_REPECHAGE', n);
    const graph = strategyFor('ELIMINATION_WITH_REPECHAGE')!.build(size);
    const rounds = eliminationRounds(size);
    const poolFinal = mainKey(rounds - 1, 1); // подгруппа A
    const step1 = graph.nodes.find((x) => x.key === repechageKey('A', 1))!;
    expect(nodeDependencies(step1, graph)).toEqual([poolFinal]);
    expect(participantsKnownAtPublish(step1)).toBe(false);
  });

  it('утешительная схватка шага 2+ зависит от предыдущего шага и от финала подгруппы (тот же узел)', () => {
    const n = 16;
    const size = drawSize('ELIMINATION_WITH_REPECHAGE', n);
    const graph = strategyFor('ELIMINATION_WITH_REPECHAGE')!.build(size);
    const rounds = eliminationRounds(size);
    const poolFinal = mainKey(rounds - 1, 2); // подгруппа B
    const step2 = graph.nodes.find((x) => x.key === repechageKey('B', 2))!;
    expect(nodeDependencies(step2, graph).sort()).toEqual([poolFinal, repechageKey('B', 1)].sort());
  });

  it('финал зависит от финалов обеих подгрупп', () => {
    const n = 16;
    const size = drawSize('ELIMINATION_WITH_REPECHAGE', n);
    const graph = strategyFor('ELIMINATION_WITH_REPECHAGE')!.build(size);
    const rounds = eliminationRounds(size);
    const final = graph.nodes.find((x) => x.key === mainKey(rounds, 1))!;
    expect(nodeDependencies(final, graph).sort()).toEqual(
      [mainKey(rounds - 1, 1), mainKey(rounds - 1, 2)].sort(),
    );
  });
});
