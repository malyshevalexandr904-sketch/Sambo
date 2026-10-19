// Места в подгруппах рейтингового формата (ТЗ 31; docs/RATED_TOURNAMENT_FORMAT.md, 3): критерии — данные версии
// формата (GroupStandingRules), применяются по порядку к равным; разделившиеся равные снова сравниваются с первого
// критерия (личные встречи — внутри меньшей группы). Неразрешённое равенство — общее место; если оно на границе
// выхода в финальную часть или среди вышедших, выход и пары финала не решаются автоматически (decisionRequired).
// Рейтинг в местах не участвует (ТЗ 22).
import type { GroupStandingCriterion, GroupStandingRules, RatedGroupLetter, WinMethod } from '@sde/contracts';
import type { BracketGraph, BracketState, GroupDecisions, Outcome } from './graph';
import { entryOf, losersOf, winnerOf } from './graph';

/** Чистая победа для мест: чистая, а также неявка, снятие, травма, дисквалификация соперника (решение заказчика). */
const CLEAN_METHODS: readonly WinMethod[] = [
  'TOTAL_VICTORY',
  'NO_SHOW',
  'WITHDRAWAL',
  'INJURY',
  'DISQUALIFICATION',
];

interface Game {
  winner: string;
  loser: string;
  method: WinMethod;
}

export interface GroupStandingRow {
  entryId: string;
  position: number;
  matches: number;
  wins: number;
  losses: number;
  points: number;
  headToHeadWins: number;
  cleanWins: number;
  superiorityWins: number;
  qualified: boolean | null;
}

export interface GroupStanding {
  group: RatedGroupLetter;
  complete: boolean;
  decisionRequired: boolean;
  /** Порядок общего места задан решением людей. */
  decided: boolean;
  rows: GroupStandingRow[];
}

const sameMembers = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Ярусы общего места, разделённые решением людей: ярус, совпавший с решением по составу, — в его порядке. */
function applyDecision(tiers: string[][], decision: readonly (readonly string[])[]): string[][] {
  return tiers.flatMap((tier) => {
    const order = tier.length > 1 ? decision.find((d) => sameMembers(d, tier)) : undefined;
    return order ? order.map((id) => [id]) : [tier];
  });
}

const winsAgainst = (id: string, members: ReadonlySet<string>, games: readonly Game[]): number =>
  games.filter((g) => g.winner === id && members.has(g.loser)).length;

function criterionValue(
  c: GroupStandingCriterion,
  id: string,
  tied: ReadonlySet<string>,
  games: Game[],
): number {
  switch (c) {
    case 'WINS':
      return games.filter((g) => g.winner === id).length;
    case 'HEAD_TO_HEAD':
      return winsAgainst(id, tied, games);
    case 'CLEAN_WINS':
      return games.filter((g) => g.winner === id && CLEAN_METHODS.includes(g.method)).length;
    case 'SUPERIORITY_WINS':
      return games.filter((g) => g.winner === id && g.method === 'SUPERIORITY').length;
  }
}

/** Ярусы равных по порядку мест: первый критерий, разделивший равных, — и каждый ярус заново с первого критерия. */
function orderTiers(
  group: readonly string[],
  games: Game[],
  criteria: readonly GroupStandingCriterion[],
): string[][] {
  if (group.length <= 1) return [[...group]];
  const tied = new Set(group);
  for (const c of criteria) {
    const value = new Map(group.map((id) => [id, criterionValue(c, id, tied, games)]));
    const levels = [...new Set(value.values())].sort((a, b) => b - a);
    if (levels.length > 1)
      return levels.flatMap((v) =>
        orderTiers(
          group.filter((id) => value.get(id) === v),
          games,
          criteria,
        ),
      );
  }
  return [[...group].sort()];
}

interface Stat {
  matches: number;
  wins: number;
  losses: number;
  points: number;
}

/** Участники, статистика и решённые схватки подгруппы; complete — все схватки решены или не нужны. */
function collect(
  graph: BracketGraph,
  group: RatedGroupLetter,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
) {
  const participants = new Set<string>();
  const stats = new Map<string, Stat>();
  const stat = (id: string): Stat => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { matches: 0, wins: 0, losses: 0, points: 0 }));
    return s;
  };
  const games: Game[] = [];
  let complete = true;
  for (const node of graph.nodes.filter((n) => n.group === group)) {
    const s = state.get(node.key);
    for (const side of [s?.red, s?.blue]) {
      const id = side ? entryOf(side) : null;
      if (id) participants.add(id);
    }
    if (s?.status !== 'DECIDED') {
      if (s?.status !== 'WALKOVER' && s?.status !== 'EMPTY') complete = false;
      continue;
    }
    const outcome = outcomes.get(node.key);
    const winner = winnerOf(s);
    for (const [side, score] of [
      [s.red, outcome?.redScore],
      [s.blue, outcome?.blueScore],
    ] as const) {
      const id = entryOf(side);
      if (!id) continue;
      stat(id).matches += 1;
      stat(id).points += score ?? 0;
    }
    if (winner) stat(winner).wins += 1;
    for (const loser of losersOf(s)) stat(loser).losses += 1;
    const loser = losersOf(s)[0];
    if (winner && loser && outcome) games.push({ winner, loser, method: outcome.method });
  }
  return { participants, stat, games, complete };
}

/** Таблица одной подгруппы. */
export function standingOf(
  graph: BracketGraph,
  group: RatedGroupLetter,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
  rules: GroupStandingRules,
  qualifiers: number,
  decision: readonly (readonly string[])[] = [],
): GroupStanding {
  const { participants, stat, games, complete } = collect(graph, group, state, outcomes);
  const byCriteria = orderTiers([...participants].sort(), games, rules.criteria);
  // Решение людей действует только у завершённой подгруппы: до конца круга равенство ещё может разрешиться.
  const tiers = complete ? applyDecision(byCriteria, decision) : byCriteria;
  const rows: GroupStandingRow[] = [];
  let decisionRequired = false;
  for (const tier of tiers) {
    const position = rows.length + 1;
    const last = position + tier.length - 1;
    // Выход решается только у завершённой подгруппы; общее место через границу — решение людей. Общее место среди
    // вышедших тоже требует решения: от него зависит пара финальной части (A1 — B2). Одна подгруппа
    // (qualifiers = 0) финальной части не имеет — выхода нет.
    const settled = complete && qualifiers > 0;
    const qualified = !settled ? null : last <= qualifiers ? true : position > qualifiers ? false : null;
    if (settled && tier.length > 1 && position <= qualifiers) decisionRequired = true;
    const tied = new Set(tier);
    const byWins = new Set([...participants].filter((id) => stat(id).wins === stat(tier[0] as string).wins));
    for (const id of tier) {
      const s = stat(id);
      rows.push({
        entryId: id,
        position,
        matches: s.matches,
        wins: s.wins,
        losses: s.losses,
        points: s.points,
        headToHeadWins: byWins.size > 1 ? winsAgainst(id, byWins, games) : 0,
        cleanWins: criterionValue('CLEAN_WINS', id, tied, games),
        superiorityWins: criterionValue('SUPERIORITY_WINS', id, tied, games),
        qualified,
      });
    }
  }
  return { group, complete, decisionRequired, decided: tiers.length !== byCriteria.length, rows };
}

/** Таблицы всех подгрупп сетки рейтингового формата по порядку букв. */
export function groupStandings(
  graph: BracketGraph,
  state: BracketState,
  outcomes: ReadonlyMap<string, Outcome>,
  rules: GroupStandingRules,
  qualifiers: number,
  decisions: GroupDecisions = new Map(),
): GroupStanding[] {
  const groups = [...new Set(graph.nodes.flatMap((n) => (n.group ? [n.group] : [])))].sort();
  return groups.map((g) => standingOf(graph, g, state, outcomes, rules, qualifiers, decisions.get(g)));
}

/**
 * Ярусы общего места, которые требуют решения людей: завершённая подгруппа, место яруса — среди выходящих
 * (на границе или внутри). Пусто — решать нечего.
 */
export function undecidedTiers(standing: GroupStanding, qualifiers: number): string[][] {
  if (!standing.complete || qualifiers === 0) return [];
  const byPosition = new Map<number, string[]>();
  for (const r of standing.rows)
    byPosition.set(r.position, [...(byPosition.get(r.position) ?? []), r.entryId]);
  return [...byPosition.entries()]
    .filter(([position, ids]) => ids.length > 1 && position <= qualifiers)
    .map(([, ids]) => ids);
}
