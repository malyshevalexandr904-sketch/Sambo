// Публичный интерфейс модуля matches.
export { MatchesModule } from './matches.module';
export {
  type ConfirmedOutcome,
  MatchesService,
  type MatchSpec,
  type SideInit,
} from './application/matches.service';
export { type EventWrite, MatchStoreService, type ProvisionalWrite } from './application/match-store.service';
export {
  entryOn,
  isConfirmed,
  isPlayed,
  isStartedOrPlayed,
  isSystemDecided,
  MATCH_INCLUDE,
  type MatchRecord,
  sideOf,
} from './application/match-record';
