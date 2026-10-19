// Рейтинговый формат SPECIAL_GROUP_RATED (docs/RATED_TOURNAMENT_FORMAT.md, 1, 6): подгруппы по кругу по схемам кругов
// версии формата. Позиции жеребьёвки идут подгруппа за подгруппой (rated-groups жеребьёвки), поэтому граф зависит
// только от числа участников. Места в подгруппах — по критериям версии формата (group-standings); финальная часть —
// фаза 12.
import {
  RATED_GROUP_LETTERS,
  RATED_GROUPS_V1,
  ratedFormatPlan,
  ratedFormatRule,
  ratedRoundSchedule,
  snakeGroups,
} from '@sde/contracts';
import type { BracketGraph, BracketState, GraphNode, Outcome, Placement } from './graph';
import { type GroupStanding, groupStandings } from './group-standings';

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

/** Выходят из каждой подгруппы в финальную часть по правилу формата для размера сетки. */
export const ratedQualifiers = (graph: BracketGraph): number =>
  ratedFormatRule(graph.size)?.qualifiersPerGroup ?? 0;

/** Таблицы подгрупп по критериям версии формата. */
export function ratedGroupStandings(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
): GroupStanding[] {
  return groupStandings(graph, state, outcomes, RATED_GROUPS_V1.groupStandingRules, ratedQualifiers(graph));
}

/**
 * Места: одна подгруппа (3–5 участников) — места её таблицы, когда все схватки решены. Несколько подгрупп — места
 * определяет финальная часть (фаза 12), до неё итогов категории нет.
 */
export function ratedPlacements(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
): Placement[] | null {
  const standings = ratedGroupStandings(graph, state, outcomes);
  const [only] = standings;
  if (standings.length !== 1 || !only?.complete) return null;
  return only.rows.map((r) => ({ entryId: r.entryId, place: r.position, wins: r.wins, losses: r.losses }));
}
