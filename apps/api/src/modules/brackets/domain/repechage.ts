// Выбывание с утешительными схватками (ELIMINATION_WITH_REPECHAGE) — основная система самбо (ARCHITECTURE.md, 14.4).
// Сетка делится на подгруппы A (верхняя половина) и B (нижняя). В каждой подгруппе — олимпийская система до
// победителя подгруппы; победители подгрупп встречаются в финале. Проигравшие победителю своей подгруппы продолжают
// в утешительных схватках подгруппы: проигравший ему в 1-м круге встречается с проигравшим во 2-м, победитель —
// с проигравшим в 3-м и так далее до проигравшего в финале подгруппы. Победители утешительных схваток подгрупп —
// два третьих места. Участников утешительных схваток определяет формат после финалов подгрупп (источник DYNAMIC).
import { eliminationRounds, type Pool } from '@sde/contracts';
import {
  BYE,
  type BracketGraph,
  type BracketState,
  entry,
  type GraphNode,
  loserOf,
  PENDING,
  type Placement,
  type SideState,
  type Source,
  winnerOf,
} from './graph';
import { eliminationRanks, mainBracketNodes, mainKey } from './elimination';
import { isComplete, placesByRank, winLoss } from './resolve';

export const repechageKey = (pool: Pool, step: number): string => `REPECHAGE:${pool}:${step}`;

const POOLS: readonly Pool[] = ['A', 'B'];

/** Место проигравшего в утешительной схватке шага step из steps: последний шаг — 5-е, предыдущий — 7-е. */
const repechageLoserPlace = (steps: number, step: number): number => 5 + 2 * (steps - step);

function repechageNodes(size: number): GraphNode[] {
  const steps = eliminationRounds(size) - 2;
  const nodes: GraphNode[] = [];
  for (let step = 1; step <= steps; step++)
    for (const pool of POOLS)
      nodes.push({
        key: repechageKey(pool, step),
        stage: 'REPECHAGE',
        round: step,
        position: pool === 'A' ? 1 : 2,
        label: step === steps ? 'BRONZE' : 'REPECHAGE',
        red:
          step === 1
            ? { type: 'DYNAMIC', rule: 'LOST_TO_POOL_WINNER', pool, round: 1 }
            : { type: 'WINNER_OF', node: repechageKey(pool, step - 1) },
        blue: { type: 'DYNAMIC', rule: 'LOST_TO_POOL_WINNER', pool, round: step + 1 },
        winnerTo: step < steps ? { node: repechageKey(pool, step + 1), side: 'RED' } : null,
        loserTo: null,
        placeForWinner: step === steps ? 3 : null,
        placeForLoser: repechageLoserPlace(steps, step),
      });
  return nodes;
}

export function buildRepechage(size: number): BracketGraph {
  const rounds = eliminationRounds(size);
  // Финалы подгрупп — предпоследний круг. В сетке на 4 утешительных схваток нет: проигравшие финалов подгрупп — третьи.
  const main = mainBracketNodes(size).map((n) =>
    rounds === 2 && n.round === 1 ? { ...n, placeForLoser: 3 } : n,
  );
  return { format: 'ELIMINATION_WITH_REPECHAGE', size, nodes: [...main, ...repechageNodes(size)] };
}

/**
 * Проигравший победителю подгруппы в круге round основной сетки. Известен, когда решён финал подгруппы.
 * Победитель прошёл этот круг без схватки (BYE) — соперника нет, сторона утешительной схватки пуста.
 */
export function lostToPoolWinner(
  source: Extract<Source, { type: 'DYNAMIC' }>,
  graph: BracketGraph,
  state: BracketState,
): SideState {
  const rounds = eliminationRounds(graph.size);
  const poolFinal = state.get(mainKey(rounds - 1, source.pool === 'A' ? 1 : 2));
  const champion = winnerOf(poolFinal);
  if (!poolFinal || !champion) return PENDING;
  const count = graph.size / 2 ** source.round;
  const from = source.pool === 'A' ? 1 : count / 2 + 1;
  for (let position = from; position < from + count / 2; position++) {
    const s = state.get(mainKey(source.round, position));
    if (!s) continue;
    const sides = [s.red, s.blue];
    if (!sides.some((x) => x.kind === 'ENTRY' && x.entryId === champion)) continue;
    const loser = loserOf(s);
    return loser ? entry(loser) : BYE;
  }
  return BYE;
}

export function repechagePlacements(graph: BracketGraph, state: BracketState): Placement[] | null {
  if (!isComplete(state)) return null;
  const rounds = eliminationRounds(graph.size);
  const steps = rounds - 2;
  // Основа — круг выбывания в основной сетке; финалисты и утешительные схватки — выше.
  const ranks = eliminationRanks(graph, state);
  const final = state.get(mainKey(rounds, 1));
  const champion = winnerOf(final);
  const runnerUp = loserOf(final);
  if (champion) ranks.set(champion, 1000);
  if (runnerUp) ranks.set(runnerUp, 999);
  // Сетка на двоих — только финал: подгрупп и утешительных схваток нет.
  for (const pool of rounds >= 2 ? POOLS : []) {
    if (steps < 1) {
      const semiLoser = loserOf(state.get(mainKey(1, pool === 'A' ? 1 : 2)));
      if (semiLoser) ranks.set(semiLoser, 998);
      continue;
    }
    for (let step = 1; step <= steps; step++) {
      const s = state.get(repechageKey(pool, step));
      const loser = loserOf(s);
      if (loser) ranks.set(loser, 500 + step);
      const bronze = step === steps ? winnerOf(s) : null;
      if (bronze) ranks.set(bronze, 998);
    }
  }
  return placesByRank(ranks, winLoss(state));
}
