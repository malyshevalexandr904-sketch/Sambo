// Публичный интерфейс модуля brackets.
export { BracketsModule } from './brackets.module';
export { BracketsService, type BracketSource, type SlotRow } from './application/brackets.service';
export type { MatchDurations } from './application/bracket-mapping';
export { matchDurationSeconds, youngestAge, type CategoryAgeSpan } from './domain/duration';
export {
  BRACKET_ALGORITHM_VERSION,
  type FormatIssue,
  MAX_DRAW_PARTICIPANTS,
  strategyFor,
} from './domain/strategies';
