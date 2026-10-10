// Публичный интерфейс модуля brackets.
export { BracketsModule } from './brackets.module';
export {
  BracketsService,
  type BracketSource,
  type MatchDependency,
  type SlotRow,
} from './application/brackets.service';
export type { MatchDurations } from './application/bracket-mapping';
export { matchDurationSeconds, youngestAge, type CategoryAgeSpan } from './domain/duration';
export {
  BRACKET_ALGORITHM_VERSION,
  type FormatIssue,
  MAX_DRAW_PARTICIPANTS,
  strategyFor,
} from './domain/strategies';
export type { BracketGraph, GraphNode, Placement } from './domain/graph';
export { nodeDependencies, participantsKnownAtPublish } from './domain/dependencies';
export { numberingOrder } from './application/bracket-mapping';
