// Преобразования графа сетки: строки узлов для БД, спецификации схваток по состоянию, порядок нумерации, DTO.
import type { BracketNodeDto, BracketStage } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { MatchRecord, MatchSpec, SideInit } from '../../matches';
import {
  type BracketGraph,
  type BracketState,
  type GraphNode,
  type NodeState,
  type SideState,
  sourceToRecord,
} from '../domain/graph';

export interface MatchDurations {
  main: number | null;
  repechage: number | null;
}

/** Этап сетки для таблицы bracket: основная сетка (или круговая группа), затем утешительные схватки. */
export const STAGE_ORDER: Record<BracketStage, number> = { MAIN: 1, POOL: 1, REPECHAGE: 2 };

const sideInit = (s: SideState): SideInit =>
  s.kind === 'ENTRY' ? { entryId: s.entryId, bye: false } : { entryId: null, bye: s.kind === 'BYE' };

/** Состояние узла; отсутствие — ошибка построения графа, а не данных пользователя. */
export function nodeState(state: BracketState, key: string): NodeState {
  const s = state.get(key);
  if (!s) throw new Error(`No state for bracket node ${key}`);
  return s;
}

export function matchSpec(
  node: GraphNode,
  state: NodeState,
  bracketNodeId: string,
  durations: MatchDurations,
): MatchSpec {
  return {
    bracketNodeId,
    roundLabel: node.label,
    durationSeconds: node.stage === 'REPECHAGE' ? durations.repechage : durations.main,
    red: sideInit(state.red),
    blue: sideInit(state.blue),
    resolution: state.status === 'WALKOVER' ? 'WALKOVER' : state.status === 'EMPTY' ? 'EMPTY' : 'OPEN',
    winnerSide: state.status === 'WALKOVER' ? state.winner : null,
  };
}

/**
 * Порядок номеров схваток категории: основная сетка по кругам, затем утешительные схватки по шагам, финал —
 * последним (его участники определяются раньше, но проводится он после утешительных схваток).
 */
export function numberingOrder(graph: BracketGraph): GraphNode[] {
  const finalRound = Math.max(0, ...graph.nodes.filter((n) => n.stage === 'MAIN').map((n) => n.round));
  const group = (n: GraphNode): number =>
    n.stage === 'MAIN' && n.label === 'FINAL' && n.round === finalRound ? 2 : n.stage === 'REPECHAGE' ? 1 : 0;
  return [...graph.nodes].sort((a, b) => group(a) - group(b) || a.round - b.round || a.position - b.position);
}

export function nodeRows(
  graph: BracketGraph,
  ids: ReadonlyMap<string, string>,
  bracketIds: ReadonlyMap<BracketStage, string>,
  competitionId: string,
): Prisma.BracketNodeCreateManyInput[] {
  const idOf = (key: string): string => {
    const id = ids.get(key);
    if (!id) throw new Error(`Unknown bracket node ${key}`);
    return id;
  };
  return graph.nodes.map((n) => {
    const red = sourceToRecord(n.red);
    const blue = sourceToRecord(n.blue);
    return {
      id: idOf(n.key),
      competitionId,
      bracketId: bracketIds.get(n.stage) as string,
      key: n.key,
      round: n.round,
      position: n.position,
      label: n.label,
      redSource: red.type,
      redSourceRef: red.ref,
      blueSource: blue.type,
      blueSourceRef: blue.ref,
      winnerToNodeId: n.winnerTo ? idOf(n.winnerTo.node) : null,
      winnerToSide: n.winnerTo?.side ?? null,
      loserToNodeId: n.loserTo ? idOf(n.loserTo.node) : null,
      loserToSide: n.loserTo?.side ?? null,
      placeForWinner: n.placeForWinner,
      placeForLoser: n.placeForLoser,
    };
  });
}

const sideDto = (s: SideState, node: GraphNode, which: 'red' | 'blue') => ({
  entryId: s.kind === 'ENTRY' ? s.entryId : null,
  bye: s.kind === 'BYE',
  source: sourceToRecord(node[which]),
});

/** Узлы сетки для экрана: состояние по жеребьёвке и исходам, схватка — если сетка опубликована. */
export function nodeDtos(
  graph: BracketGraph,
  state: BracketState,
  matchOf: (key: string) => MatchRecord | undefined = () => undefined,
): BracketNodeDto[] {
  return graph.nodes.map((n) => {
    const s = nodeState(state, n.key);
    const m = matchOf(n.key);
    return {
      key: n.key,
      stage: n.stage,
      round: n.round,
      position: n.position,
      label: n.label,
      placeForWinner: n.placeForWinner,
      placeForLoser: n.placeForLoser,
      red: sideDto(s.red, n, 'red'),
      blue: sideDto(s.blue, n, 'blue'),
      winnerTo: n.winnerTo ? { key: n.winnerTo.node, side: n.winnerTo.side } : null,
      status: s.status,
      winnerSide: s.winner,
      match: m
        ? {
            id: m.id,
            publicId: m.publicId,
            number: m.matchNumber,
            status: m.status,
            winnerSide: m.winnerSide,
            durationSeconds: m.durationSeconds,
            result: m.result
              ? {
                  status: m.result.status,
                  winnerSide: m.result.winnerSide,
                  method: m.result.method,
                  redScore: m.result.redScore,
                  blueScore: m.result.blueScore,
                }
              : null,
          }
        : null,
    };
  });
}
