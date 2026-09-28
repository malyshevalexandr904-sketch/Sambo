// Реестр стратегий форматов (ARCHITECTURE.md, 14.4; точка расширения «Форматы»): 5a — круговая система,
// олимпийская система и выбывание с утешительными схватками; форматы 5b добавляются новыми стратегиями без
// изменения ядра (граф, разрешение состояния, хранение).
import type { CompetitionFormatCode, DrawFormat } from '@sde/contracts';
import { buildSingleElimination, singleEliminationPlacements } from './elimination';
import type { BracketGraph, BracketState, Outcome, Placement } from './graph';
import { buildRepechage, lostToPoolWinner, repechagePlacements } from './repechage';
import { type DynamicResolver, resolveBracket, type SlotMap } from './resolve';
import { buildRoundRobin, roundRobinPlacements } from './round-robin';

/** Версия построения сеток: меняется при изменении графа или правил мест. */
export const BRACKET_ALGORITHM_VERSION = 'bracket-v1';

/** Технический предел размера категории: 256 позиций сетки. Число участников по формату задают правила. */
export const MAX_DRAW_PARTICIPANTS = 256;

export type FormatIssue = 'not_enough_participants' | 'too_many_participants';

export interface FormatStrategy {
  readonly code: DrawFormat;
  validate(participants: number): FormatIssue | null;
  /** Граф по числу позиций жеребьёвки (drawSize). */
  build(size: number): BracketGraph;
  dynamic?: DynamicResolver;
  /** Места завершённой сетки; null — сетка ещё не завершена. */
  placements(
    graph: BracketGraph,
    state: BracketState,
    outcomes: ReadonlyMap<string, Outcome>,
  ): Placement[] | null;
}

const validate = (participants: number): FormatIssue | null => {
  if (participants < 2) return 'not_enough_participants';
  if (participants > MAX_DRAW_PARTICIPANTS) return 'too_many_participants';
  return null;
};

const STRATEGIES: Record<DrawFormat, FormatStrategy> = {
  ROUND_ROBIN: {
    code: 'ROUND_ROBIN',
    validate,
    build: buildRoundRobin,
    placements: roundRobinPlacements,
  },
  SINGLE_ELIMINATION: {
    code: 'SINGLE_ELIMINATION',
    validate,
    build: buildSingleElimination,
    placements: (graph, state) => singleEliminationPlacements(graph, state),
  },
  ELIMINATION_WITH_REPECHAGE: {
    code: 'ELIMINATION_WITH_REPECHAGE',
    validate,
    build: buildRepechage,
    dynamic: lostToPoolWinner,
    placements: (graph, state) => repechagePlacements(graph, state),
  },
};

export function strategyFor(format: CompetitionFormatCode): FormatStrategy | null {
  return (STRATEGIES as Partial<Record<CompetitionFormatCode, FormatStrategy>>)[format] ?? null;
}

/** Состояние сетки формата: жеребьёвка + подтверждённые исходы. */
export function resolveFormat(
  strategy: FormatStrategy,
  graph: BracketGraph,
  slots: SlotMap,
  outcomes: ReadonlyMap<string, Outcome> = new Map(),
): BracketState {
  return resolveBracket(graph, slots, outcomes, strategy.dynamic);
}
