// Олимпийская система (SINGLE_ELIMINATION) и основная сетка выбывания: круг r имеет size / 2^r узлов,
// победитель узла p идёт в узел ⌈p/2⌉ следующего круга (нечётный — красным, чётный — синим).
// Места: 1 — победитель финала, 2 — проигравший финала, 3 — оба проигравших полуфинала, далее — по кругу выбывания.
import { eliminationRoundLabel, eliminationRounds } from '@sde/contracts';
import type { BracketGraph, BracketState, GraphNode, Placement } from './graph';
import { loserOf, winnerOf } from './graph';
import { isComplete, placesByRank, winLoss } from './resolve';

export const mainKey = (round: number, position: number): string => `MAIN:${round}:${position}`;

/** Узлы основной сетки на выбывание (все круги до финала включительно). */
export function mainBracketNodes(size: number): GraphNode[] {
  const rounds = eliminationRounds(size);
  const nodes: GraphNode[] = [];
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let position = 1; position <= count; position++) {
      const first = round === 1;
      nodes.push({
        key: mainKey(round, position),
        stage: 'MAIN',
        round,
        position,
        label: eliminationRoundLabel(size, round),
        red: first
          ? { type: 'DRAW_SLOT', position: 2 * position - 1 }
          : { type: 'WINNER_OF', node: mainKey(round - 1, 2 * position - 1) },
        blue: first
          ? { type: 'DRAW_SLOT', position: 2 * position }
          : { type: 'WINNER_OF', node: mainKey(round - 1, 2 * position) },
        winnerTo:
          round < rounds
            ? { node: mainKey(round + 1, Math.ceil(position / 2)), side: position % 2 === 1 ? 'RED' : 'BLUE' }
            : null,
        loserTo: null,
        placeForWinner: round === rounds ? 1 : null,
        placeForLoser: round === rounds ? 2 : null,
      });
    }
  }
  return nodes;
}

export function buildSingleElimination(size: number): BracketGraph {
  const rounds = eliminationRounds(size);
  const nodes = mainBracketNodes(size).map((n) =>
    rounds >= 2 && n.round === rounds - 1 ? { ...n, placeForLoser: 3 } : n,
  );
  return { format: 'SINGLE_ELIMINATION', size, nodes };
}

/**
 * Ранг выбывания в основной сетке: победитель финала — rounds + 1, остальные — круг, в котором проиграли схватку.
 * Участник, не проигравший ни одной схватки основной сетки, ранга не получает.
 */
export function eliminationRanks(graph: BracketGraph, state: BracketState): Map<string, number> {
  const rounds = eliminationRounds(graph.size);
  const ranks = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.stage !== 'MAIN') continue;
    const s = state.get(node.key);
    const loser = loserOf(s);
    if (loser) ranks.set(loser, node.round);
    if (node.round === rounds) {
      const champion = winnerOf(s);
      if (champion) ranks.set(champion, rounds + 1);
    }
  }
  return ranks;
}

export function singleEliminationPlacements(graph: BracketGraph, state: BracketState): Placement[] | null {
  if (!isComplete(state)) return null;
  return placesByRank(eliminationRanks(graph, state), winLoss(state));
}
