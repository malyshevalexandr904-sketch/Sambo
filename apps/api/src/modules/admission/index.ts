// Публичный интерфейс модуля admission.
export { AdmissionModule } from './admission.module';
export {
  type AdmissionCompetition,
  AdmissionSources,
  type AdmissionSubject,
  type SourceCheckKind,
} from './application/admission-sources';
export { AdmissionService, toAdmissionSummary } from './application/admission.service';
export {
  ENTRY_VIEW_SELECT,
  entryCursor,
  entrySearch,
  type EntryView,
  organizationOf,
  toAthleteBrief,
  toCategoryRef,
} from './application/entry-views';
export {
  type CheckOutcome,
  evaluateCheckIn,
  evaluateMedical,
  evaluateWeight,
  type MedicalFact,
  type WeightFact,
} from './domain/admission-rules';
