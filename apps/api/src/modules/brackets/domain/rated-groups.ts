// Рейтинговый формат SPECIAL_GROUP_RATED (docs/RATED_TOURNAMENT_FORMAT.md, 1, 3, 6): подгруппы по кругу по схемам
// кругов версии формата, затем финальная часть на выбывание по парам версии (A1 — B2 …). Позиции жеребьёвки идут
// подгруппа за подгруппой (rated-groups жеребьёвки), поэтому граф зависит только от числа участников. Места в
// подгруппах — по критериям версии формата (group-standings); участник финальной части — место подгруппы (POOL_RANK),
// известное, когда подгруппа завершена и место занимает один участник. Места категории — по PlacementRules версии.
import {
  eliminationRoundLabel,
  eliminationRounds,
  type PlacementRules,
  parseQualifierRef,
  RATED_GROUP_LETTERS,
  RATED_GROUPS_V1,
  type RatedFormatRule,
  ratedFormatPlan,
  ratedFormatRule,
  ratedRoundSchedule,
  type RoundLabel,
  snakeGroups,
} from '@sde/contracts';
import {
  type BracketGraph,
  type BracketState,
  entry,
  type GraphNode,
  type GroupDecisions,
  losersOf,
  type Outcome,
  PENDING,
  type Placement,
  type Source,
  winnerOf,
} from './graph';
import { type GroupStanding, groupStandings, standingOf } from './group-standings';
import { isComplete, type PoolRankResolver, winLoss } from './resolve';

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

export const finalKey = (round: number, position: number): string => `FINAL:${round}:${position}`;

const PLACEMENTS: PlacementRules = RATED_GROUPS_V1.placementRules;

/** Место проигравшего схватку круга финальной части по PlacementRules; финал — 2, полуфинал — 3. */
function loserPlace(label: RoundLabel): number | null {
  if (label === 'FINAL' || label === 'SEMIFINAL' || label === 'QUARTERFINAL') return PLACEMENTS.losers[label];
  return null;
}

/**
 * Финальная часть на выбывание: первый круг — пары версии формата (участники — места подгрупп), соседние пары
 * сходятся в следующем круге. Схватки за 3 место нет: оба проигравших полуфиналы — 3 место.
 */
function finalNodes(rule: RatedFormatRule): GraphNode[] {
  const size = rule.finalBracketSize;
  if (size === 0) return [];
  const rounds = eliminationRounds(size);
  const rank = (ref: string): Source => ({ type: 'POOL_RANK', ...parseQualifierRef(ref) });
  const nodes: GraphNode[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let position = 1; position <= size / 2 ** round; position++) {
      const pair = rule.finalPairing[position - 1];
      const label = eliminationRoundLabel(size, round);
      nodes.push({
        key: finalKey(round, position),
        stage: 'FINAL',
        round,
        position,
        label,
        red:
          round === 1 && pair
            ? rank(pair[0])
            : { type: 'WINNER_OF', node: finalKey(round - 1, 2 * position - 1) },
        blue:
          round === 1 && pair
            ? rank(pair[1])
            : { type: 'WINNER_OF', node: finalKey(round - 1, 2 * position) },
        winnerTo:
          round < rounds
            ? {
                node: finalKey(round + 1, Math.ceil(position / 2)),
                side: position % 2 === 1 ? 'RED' : 'BLUE',
              }
            : null,
        loserTo: null,
        placeForWinner: round === rounds ? 1 : null,
        placeForLoser: loserPlace(label),
      });
    }
  }
  return nodes;
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
  // Узлы подгрупп — раньше финальной части: её стороны разрешаются по уже известному состоянию подгрупп.
  nodes.push(...finalNodes(rule));
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
  decisions: GroupDecisions = new Map(),
): GroupStanding[] {
  return groupStandings(
    graph,
    state,
    outcomes,
    RATED_GROUPS_V1.groupStandingRules,
    ratedQualifiers(graph),
    decisions,
  );
}

/**
 * Участник финальной части «A1»: подгруппа завершена и место занимает один участник. Общее место (критерии не
 * разделили) — сторона ждёт решения людей (decisionRequired в таблице подгруппы, решение — GroupDecisions).
 */
export const ratedPoolRank: PoolRankResolver = (source, graph, state, outcomes, decisions) => {
  const standing = standingOf(
    graph,
    source.group,
    state,
    outcomes,
    RATED_GROUPS_V1.groupStandingRules,
    ratedQualifiers(graph),
    decisions.get(source.group),
  );
  if (!standing.complete) return PENDING;
  const rows = standing.rows.filter((r) => r.position === source.place);
  return rows.length === 1 ? entry((rows[0] as GroupStanding['rows'][number]).entryId) : PENDING;
};

/** Места финальной части: победитель финала и проигравшие по кругам — по placeForWinner / placeForLoser узлов. */
function finalPlaces(graph: BracketGraph, state: BracketState): Map<string, number> {
  const places = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.stage !== 'FINAL') continue;
    const s = state.get(node.key);
    const champion = node.placeForWinner === null ? null : winnerOf(s);
    if (champion && node.placeForWinner !== null) places.set(champion, node.placeForWinner);
    if (node.placeForLoser !== null) for (const loser of losersOf(s)) places.set(loser, node.placeForLoser);
  }
  return places;
}

/**
 * Места: одна подгруппа (3–5 участников) — места её таблицы, когда все схватки решены. Несколько подгрупп — по
 * финальной части, когда сетка завершена (PlacementRules: 1, 2, два третьих, проигравшие четвертьфиналы); не вышедшие
 * из подгрупп — по правилу версии: без места или после участников финальной части по месту в подгруппе.
 */
export function ratedPlacements(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
  decisions: GroupDecisions = new Map(),
): Placement[] | null {
  const standings = ratedGroupStandings(graph, state, outcomes, decisions);
  const stats = winLoss(state);
  const placement = (entryId: string, place: number): Placement => ({
    entryId,
    place,
    wins: stats.get(entryId)?.wins ?? 0,
    losses: stats.get(entryId)?.losses ?? 0,
  });
  const [only] = standings;
  if (standings.length === 1) {
    if (!only?.complete) return null;
    return only.rows.map((r) => placement(r.entryId, r.position));
  }
  if (!isComplete(state)) return null;
  const places = finalPlaces(graph, state);
  if (PLACEMENTS.nonQualifiers === 'BY_GROUP_POSITION') {
    const base = (ratedFormatRule(graph.size)?.finalBracketSize ?? places.size) + 1;
    const rest = standings.flatMap((g) => g.rows).filter((r) => !places.has(r.entryId));
    for (const r of rest) places.set(r.entryId, base + rest.filter((o) => o.position < r.position).length);
  }
  return [...places.entries()]
    .map(([entryId, place]) => placement(entryId, place))
    .sort((a, b) => a.place - b.place || (a.entryId < b.entryId ? -1 : 1));
}
