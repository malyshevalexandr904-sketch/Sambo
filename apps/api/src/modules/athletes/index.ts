export { AthletesModule } from './athletes.module';
export {
  type AthleteBasics,
  AthleteAccessService,
  type RelationInfo,
} from './application/athlete-access.service';
export {
  AthleteExtensions,
  type AthleteMergeParticipant,
  type MergeSide,
} from './application/athlete-extensions';
export { AthletesService } from './application/athletes.service';
export { electronicConsentDecision } from './domain/athlete-rules';
