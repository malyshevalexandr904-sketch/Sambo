// Граф сетки (ARCHITECTURE.md, 14.4; DATABASE.md, 3.6): узлы со ссылками на источники сторон — позицию
// жеребьёвки, победителя или проигравшего узла, правило формата (DYNAMIC: участники утешительных схваток).
// Узел играется как одна схватка. Состояние сетки — чистая функция графа, жеребьёвки и подтверждённых исходов.
import type {
  BracketNodeStatus,
  BracketStage,
  CompetitionFormatCode,
  Pool,
  RoundLabel,
  Side,
  SlotSourceType,
  WinMethod,
} from '@sde/contracts';

export type { Side };

/** Проигравшие победителю подгруппы в круге `round` основной сетки (утешительные схватки самбо). */
export type DynamicRule = 'LOST_TO_POOL_WINNER';

export type Source =
  | { type: 'DRAW_SLOT'; position: number }
  | { type: 'WINNER_OF'; node: string }
  | { type: 'LOSER_OF'; node: string }
  | { type: 'DYNAMIC'; rule: DynamicRule; pool: Pool; round: number };

export interface NodeLink {
  node: string;
  side: Side;
}

export interface GraphNode {
  /** Устойчивый ключ узла в пределах сетки: «MAIN:2:1», «REPECHAGE:A:1», «POOL:3:2». */
  key: string;
  stage: BracketStage;
  round: number;
  position: number;
  label: RoundLabel;
  red: Source;
  blue: Source;
  winnerTo: NodeLink | null;
  loserTo: NodeLink | null;
  placeForWinner: number | null;
  placeForLoser: number | null;
}

export interface BracketGraph {
  format: CompetitionFormatCode;
  /** Число позиций жеребьёвки. */
  size: number;
  /** Узлы в порядке разрешения: источники стороны узла стоят раньше него. */
  nodes: GraphNode[];
}

export type SideState = { kind: 'ENTRY'; entryId: string } | { kind: 'BYE' } | { kind: 'PENDING' };

export interface NodeState {
  red: SideState;
  blue: SideState;
  status: BracketNodeStatus;
  winner: Side | null;
}

export type BracketState = Map<string, NodeState>;

/**
 * Подтверждённый исход схватки узла. Счёт и способ нужны для мест в круговой системе. `winner: null` — неявка обоих
 * (оба сняты после жеребьёвки): схватка не проводится, оба проигравшие (план Phase 7a, §3).
 */
export interface Outcome {
  winner: Side | null;
  method: WinMethod;
  redScore?: number;
  blueScore?: number;
}

export interface Placement {
  entryId: string;
  /** Деление мест допускается: 3, 3, 5, 5. */
  place: number;
  wins: number;
  losses: number;
}

export const otherSide = (side: Side): Side => (side === 'RED' ? 'BLUE' : 'RED');

export const PENDING: SideState = { kind: 'PENDING' };
export const BYE: SideState = { kind: 'BYE' };
export const entry = (entryId: string): SideState => ({ kind: 'ENTRY', entryId });

/** Участник стороны узла или null (BYE или ещё не известен). */
export const entryOf = (s: SideState): string | null => (s.kind === 'ENTRY' ? s.entryId : null);

export const sideOf = (state: NodeState, side: Side): SideState => (side === 'RED' ? state.red : state.blue);

/** Победитель узла (в том числе без схватки) или null. */
export function winnerOf(state: NodeState | undefined): string | null {
  if (!state?.winner) return null;
  return entryOf(sideOf(state, state.winner));
}

/** Проигравший в схватке узла; у решённого без схватки узла проигравшего нет. */
export function loserOf(state: NodeState | undefined): string | null {
  if (!state?.winner || state.status !== 'DECIDED') return null;
  return entryOf(sideOf(state, otherSide(state.winner)));
}

/** Все проигравшие в схватке узла: один — или оба, если победителя нет (неявка обоих). */
export function losersOf(state: NodeState | undefined): string[] {
  if (!state || state.status !== 'DECIDED') return [];
  if (state.winner) {
    const loser = loserOf(state);
    return loser ? [loser] : [];
  }
  return [entryOf(state.red), entryOf(state.blue)].filter((x): x is string => x !== null);
}

// ---------- Хранение источников в БД: тип + строковая ссылка ----------

export function sourceToRecord(s: Source): { type: SlotSourceType; ref: string } {
  switch (s.type) {
    case 'DRAW_SLOT':
      return { type: s.type, ref: String(s.position) };
    case 'WINNER_OF':
    case 'LOSER_OF':
      return { type: s.type, ref: s.node };
    case 'DYNAMIC':
      return { type: s.type, ref: `${s.rule}:${s.pool}:${s.round}` };
  }
}

export function sourceFromRecord(type: SlotSourceType, ref: string): Source {
  if (type === 'DRAW_SLOT') return { type, position: Number(ref) };
  if (type === 'WINNER_OF' || type === 'LOSER_OF') return { type, node: ref };
  if (type === 'DYNAMIC') {
    const [rule, pool, round] = ref.split(':');
    if (rule === 'LOST_TO_POOL_WINNER' && (pool === 'A' || pool === 'B'))
      return { type, rule, pool, round: Number(round) };
  }
  throw new Error(`Unsupported bracket source ${type}:${ref}`);
}
