// Круговая система (ROUND_ROBIN): каждый встречается с каждым; круги — методом «круга» (позиция 1 на месте,
// остальные вращаются), при нечётном числе участников один отдыхает в каждом круге.
// Места: по числу побед; при равенстве — по победам во встречах между собой (рекурсивно в каждой меньшей группе),
// затем по качеству побед (чистые, затем по преимуществу); неразрешённое равенство — деление места.
import type { BracketGraph, BracketState, GraphNode, Outcome, Placement } from './graph';
import { loserOf, winnerOf } from './graph';
import { isComplete, placesByRank, winLoss } from './resolve';

export const poolKey = (round: number, position: number): string => `POOL:${round}:${position}`;

/** Пары кругов по методу «круга» для позиций 1…n: круг → [красный, синий]. */
export function roundRobinPairs(n: number): [number, number][][] {
  const m = n % 2 === 0 ? n : n + 1;
  let ring = Array.from({ length: m }, (_, i) => i + 1);
  const rounds: [number, number][][] = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = ring[i] as number;
      const b = ring[m - 1 - i] as number;
      if (a > n || b > n) continue;
      // Цвет первой пары чередуется по кругам, чтобы позиция 1 не выступала всегда в красном.
      pairs.push(i === 0 && r % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ring = [ring[0] as number, ring[m - 1] as number, ...ring.slice(1, m - 1)];
  }
  return rounds;
}

export function buildRoundRobin(size: number): BracketGraph {
  const nodes: GraphNode[] = [];
  roundRobinPairs(size).forEach((pairs, r) =>
    pairs.forEach(([red, blue], i) =>
      nodes.push({
        key: poolKey(r + 1, i + 1),
        stage: 'POOL',
        round: r + 1,
        position: i + 1,
        label: 'ROUND_ROBIN',
        red: { type: 'DRAW_SLOT', position: red },
        blue: { type: 'DRAW_SLOT', position: blue },
        winnerTo: null,
        loserTo: null,
        placeForWinner: null,
        placeForLoser: null,
      }),
    ),
  );
  return { format: 'ROUND_ROBIN', size, nodes };
}

interface Game {
  winner: string;
  loser: string;
  outcome: Outcome;
}

/** Разбиение группы по ключу (больше — лучше) на ярусы равных. */
function partition(group: readonly string[], key: (id: string) => number[]): string[][] {
  const keyed = group.map((id) => ({ id, k: key(id) }));
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  keyed.sort((a, b) => cmp(a.k, b.k) || (a.id < b.id ? -1 : 1));
  const tiers: string[][] = [];
  for (const x of keyed) {
    const last = tiers[tiers.length - 1];
    const lastKey = last ? keyed.find((y) => y.id === last[0])?.k : undefined;
    if (last && lastKey && cmp(lastKey, x.k) === 0) last.push(x.id);
    else tiers.push([x.id]);
  }
  return tiers;
}

/** Упорядоченные ярусы участников: победы внутри группы → те же правила в меньших группах → качество побед. */
function orderTiers(group: readonly string[], games: readonly Game[]): string[][] {
  if (group.length <= 1) return [[...group]];
  const members = new Set(group);
  const within = (id: string): number[] => [
    games.filter((g) => g.winner === id && members.has(g.loser)).length,
  ];
  const headToHead = partition(group, within);
  if (headToHead.length > 1) return headToHead.flatMap((t) => orderTiers(t, games));
  const quality = (id: string): number[] => {
    const won = games.filter((g) => g.winner === id);
    return [
      won.filter((g) => g.outcome.method === 'TOTAL_VICTORY').length,
      won.filter((g) => g.outcome.method === 'SUPERIORITY').length,
    ];
  };
  const byQuality = partition(group, quality);
  if (byQuality.length > 1) return byQuality.flatMap((t) => orderTiers(t, games));
  return [[...group]];
}

export function roundRobinPlacements(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
): Placement[] | null {
  if (!isComplete(state)) return null;
  const participants = new Set<string>();
  const games: Game[] = [];
  for (const node of graph.nodes) {
    const s = state.get(node.key);
    for (const side of [s?.red, s?.blue]) if (side?.kind === 'ENTRY') participants.add(side.entryId);
    const winner = winnerOf(s);
    const loser = loserOf(s);
    const outcome = outcomes.get(node.key);
    if (winner && loser && outcome) games.push({ winner, loser, outcome });
  }
  const tiers = orderTiers([...participants], games);
  const ranks = new Map<string, number>();
  tiers.forEach((tier, i) => tier.forEach((id) => ranks.set(id, tiers.length - i)));
  return placesByRank(ranks, winLoss(state));
}
