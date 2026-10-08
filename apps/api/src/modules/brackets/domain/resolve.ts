// Разрешение состояния сетки: стороны узлов по источникам, BYE без схватки, исходы схваток. Одна функция для
// публикации (начальное состояние, BYE первого круга), продвижения после подтверждения результата и его изменения:
// состояние всегда пересчитывается целиком из жеребьёвки и исходов, поэтому не накапливает расхождений.
import {
  BYE,
  type BracketGraph,
  type BracketState,
  entry,
  type GraphNode,
  losersOf,
  type NodeState,
  type Outcome,
  PENDING,
  type SideState,
  type Source,
  winnerOf,
} from './graph';

/** Правило формата для источника DYNAMIC (утешительные схватки). */
export type DynamicResolver = (
  source: Extract<Source, { type: 'DYNAMIC' }>,
  graph: BracketGraph,
  state: BracketState,
) => SideState;

/** Нарушение инварианта сетки: ошибка данных или вызова, а не пользователя. */
export class BracketInvariantError extends Error {
  constructor(
    readonly code:
      | 'unknown_position'
      | 'unknown_node'
      | 'same_entry_on_both_sides'
      | 'outcome_not_applicable'
      | 'dynamic_without_rule',
    readonly nodeKey: string,
  ) {
    super(`${code}: ${nodeKey}`);
    this.name = 'BracketInvariantError';
  }
}

/** Позиция жеребьёвки → участие (null — BYE). */
export type SlotMap = ReadonlyMap<number, string | null>;

function sideFrom(
  node: GraphNode,
  source: Source,
  ctx: { graph: BracketGraph; slots: SlotMap; state: BracketState; dynamic?: DynamicResolver },
): SideState {
  switch (source.type) {
    case 'DRAW_SLOT': {
      if (!ctx.slots.has(source.position)) throw new BracketInvariantError('unknown_position', node.key);
      const id = ctx.slots.get(source.position) ?? null;
      return id === null ? BYE : entry(id);
    }
    case 'WINNER_OF':
    case 'LOSER_OF': {
      const prev = ctx.state.get(source.node);
      if (!prev) throw new BracketInvariantError('unknown_node', node.key);
      if (prev.status === 'EMPTY') return BYE;
      if (prev.status === 'WALKOVER') {
        const w = winnerOf(prev);
        return source.type === 'WINNER_OF' && w ? entry(w) : BYE;
      }
      if (prev.status !== 'DECIDED') return PENDING;
      const id = source.type === 'WINNER_OF' ? winnerOf(prev) : (losersOf(prev)[0] ?? null);
      return id ? entry(id) : BYE;
    }
    case 'DYNAMIC':
      if (!ctx.dynamic) throw new BracketInvariantError('dynamic_without_rule', node.key);
      return ctx.dynamic(source, ctx.graph, ctx.state);
  }
}

function decide(node: GraphNode, red: SideState, blue: SideState, outcome: Outcome | undefined): NodeState {
  const both = red.kind === 'ENTRY' && blue.kind === 'ENTRY';
  if (outcome && !both) throw new BracketInvariantError('outcome_not_applicable', node.key);
  if (red.kind === 'BYE' && blue.kind === 'BYE') return { red, blue, status: 'EMPTY', winner: null };
  if (red.kind === 'BYE' && blue.kind === 'ENTRY') return { red, blue, status: 'WALKOVER', winner: 'BLUE' };
  if (blue.kind === 'BYE' && red.kind === 'ENTRY') return { red, blue, status: 'WALKOVER', winner: 'RED' };
  if (red.kind === 'ENTRY' && blue.kind === 'ENTRY') {
    if (red.entryId === blue.entryId) throw new BracketInvariantError('same_entry_on_both_sides', node.key);
    return outcome
      ? { red, blue, status: 'DECIDED', winner: outcome.winner }
      : { red, blue, status: 'READY', winner: null };
  }
  return { red, blue, status: 'PENDING', winner: null };
}

export function resolveBracket(
  graph: BracketGraph,
  slots: SlotMap,
  outcomes: ReadonlyMap<string, Outcome>,
  dynamic?: DynamicResolver,
): BracketState {
  const state: BracketState = new Map();
  const ctx = { graph, slots, state, dynamic };
  for (const node of graph.nodes) {
    const red = sideFrom(node, node.red, ctx);
    const blue = sideFrom(node, node.blue, ctx);
    state.set(node.key, decide(node, red, blue, outcomes.get(node.key)));
  }
  return state;
}

/** Сетка завершена: ни одного узла, ждущего участников или результата. */
export const isComplete = (state: BracketState): boolean =>
  [...state.values()].every((s) => s.status !== 'PENDING' && s.status !== 'READY');

/** Победы и поражения участников по сыгранным схваткам (без побед по BYE). */
export function winLoss(state: BracketState): Map<string, { wins: number; losses: number }> {
  const out = new Map<string, { wins: number; losses: number }>();
  const bump = (id: string | null, field: 'wins' | 'losses'): void => {
    if (!id) return;
    const row = out.get(id) ?? { wins: 0, losses: 0 };
    row[field] += 1;
    out.set(id, row);
  };
  for (const s of state.values()) {
    if (s.status !== 'DECIDED') continue;
    bump(winnerOf(s), 'wins');
    for (const loser of losersOf(s)) bump(loser, 'losses');
  }
  return out;
}

/**
 * Места по рангам: rank — чем больше, тем лучше; место = 1 + число участников со строго большим рангом.
 * Так делятся места: два третьих, два пятых. `floorOf` — наименьшее место ранга по правилу формата (Phase 7b):
 * если выше никого нет (оба финалиста сняты — чемпиона нет), финалист всё равно второй, а не первый.
 */
export function placesByRank(
  ranks: ReadonlyMap<string, number>,
  stats: ReadonlyMap<string, { wins: number; losses: number }>,
  floorOf: (rank: number) => number = () => 1,
): { entryId: string; place: number; wins: number; losses: number }[] {
  const values = [...ranks.values()];
  return [...ranks.entries()]
    .map(([entryId, rank]) => ({
      entryId,
      place: Math.max(floorOf(rank), 1 + values.filter((v) => v > rank).length),
      wins: stats.get(entryId)?.wins ?? 0,
      losses: stats.get(entryId)?.losses ?? 0,
    }))
    .sort((a, b) => a.place - b.place || (a.entryId < b.entryId ? -1 : 1));
}
