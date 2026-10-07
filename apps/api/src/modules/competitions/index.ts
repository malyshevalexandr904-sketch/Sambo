export { CompetitionsModule } from './competitions.module';
export {
  CompetitionScopeService,
  type CompetitionBasics,
  type CompetitionScope,
} from './application/competition-scope.service';
export {
  CompetitionExtensions,
  type CompetitionCounters,
  type TransitionCheck,
  type TransitionContext,
  type TransitionEffect,
} from './application/competition-extensions';
export { CompetitionStatusWriter } from './application/competition-status.writer';
export { CompetitionsService } from './application/competitions.service';
export {
  isBeforeCompetition,
  isPublished,
  registrationWindow,
  resubmissionAllowed,
  type RegistrationWindow,
} from './domain/competition-machine';
