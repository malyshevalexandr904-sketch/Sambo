// Рейтинговый формат SPECIAL_GROUP_RATED (docs/RATED_TOURNAMENT_FORMAT.md, 1, 6): подгруппы по кругу по схемам кругов
// версии формата. Позиции жеребьёвки идут подгруппа за подгруппой (rated-groups жеребьёвки), поэтому граф зависит
// только от числа участников. Финальная часть — фаза 12; места в подгруппах — фаза 11.
import {
  RATED_GROUP_LETTERS,
  ratedFormatPlan,
  ratedFormatRule,
  ratedRoundSchedule,
  snakeGroups,
} from '@sde/contracts';
import type { BracketGraph, BracketState, GraphNode, Outcome, Placement } from './graph';
import { roundRobinPlacements } from './round-robin';

export const groupKey = (group: string, round: number, position: number): string =>
  `GROUP:${group}:${round}:${position}`;

/** Ошибка числа участников в терминах стратегии (FormatIssue); коды формата — в жеребьёвке. */
export function validateRated(
  participants: number,
): 'not_enough_participants' | 'too_many_participants' | null {
  const plan = ratedFormatPlan(participants);
  if (plan.ok) return null;
  return plan.issue === 'INSUFFICIENT_PARTICIPANTS' ? 'not_enough_participants' : 'too_many_participants';
}

export function buildRatedGroups(size: number): BracketGraph {
  const rule = ratedFormatRule(size);
  if (!rule) throw new Error(`No rated format rule for ${size} participants`);
  const nodes: GraphNode[] = [];
  let offset = 0;
  snakeGroups(size, rule.groupCount).forEach((seeds, g) => {
    const group = RATED_GROUP_LETTERS[g] as (typeof RATED_GROUP_LETTERS)[number];
    ratedRoundSchedule(seeds.length).forEach((pairs, r) =>
      pairs.forEach(([red, blue], i) =>
        nodes.push({
          key: groupKey(group, r + 1, i + 1),
          stage: 'POOL',
          group,
          round: r + 1,
          position: i + 1,
          label: 'ROUND_ROBIN',
          red: { type: 'DRAW_SLOT', position: offset + red },
          blue: { type: 'DRAW_SLOT', position: offset + blue },
          winnerTo: null,
          loserTo: null,
          placeForWinner: null,
          placeForLoser: null,
        }),
      ),
    );
    offset += seeds.length;
  });
  return { format: 'SPECIAL_GROUP_RATED', size, nodes };
}

/**
 * Места: одна подгруппа (3–5 участников) — круговая система, места по её правилам. Несколько подгрупп — места
 * определяет финальная часть (фаза 12), до неё итогов категории нет.
 */
export function ratedPlacements(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
): Placement[] | null {
  if (new Set(graph.nodes.map((n) => n.group)).size > 1) return null;
  return roundRobinPlacements(graph, state, outcomes);
}
