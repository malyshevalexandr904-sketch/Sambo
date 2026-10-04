// Зависимости узлов сетки для планировщика расписания (Phase 6): схватка узла не может стоять раньше схваток,
// от которых зависят её стороны. WINNER_OF/LOSER_OF — прямая ссылка на узел. DYNAMIC (проигравший победителю
// подгруппы, ELIMINATION_WITH_REPECHAGE) сам по себе не хранит ссылку на узел — источник известен только после
// финала подгруппы (см. lostToPoolWinner), поэтому единственная реальная зависимость DYNAMIC-стороны — этот
// финал, независимо от круга, чей проигравший ищется (mainKey(rounds - 1, ...) — тот же для любого шага
// утешительных схваток одной подгруппы).
import { eliminationRounds } from '@sde/contracts';
import type { BracketGraph, GraphNode, Source } from './graph';
import { mainKey } from './elimination';

function keysOf(source: Source, graph: BracketGraph): string[] {
  switch (source.type) {
    case 'DRAW_SLOT':
      return [];
    case 'WINNER_OF':
    case 'LOSER_OF':
      return [source.node];
    case 'DYNAMIC': {
      const rounds = eliminationRounds(graph.size);
      return [mainKey(rounds - 1, source.pool === 'A' ? 1 : 2)];
    }
  }
}

/** Ключи узлов, от которых зависит узел (их схватки должны быть сыграны раньше). Без повторов. */
export function nodeDependencies(node: GraphNode, graph: BracketGraph): string[] {
  return [...new Set([...keysOf(node.red, graph), ...keysOf(node.blue, graph)])];
}

/**
 * Обе стороны узла известны сразу по жеребьёвке (DRAW_SLOT): круговая система и первый круг выбывания.
 * Такой узел не зависит от других схваток по сетке — но его участник ограничен минимальным отдыхом наравне
 * с остальными его схватками (планировщик, а не граф).
 */
export function participantsKnownAtPublish(node: GraphNode): boolean {
  return node.red.type === 'DRAW_SLOT' && node.blue.type === 'DRAW_SLOT';
}
