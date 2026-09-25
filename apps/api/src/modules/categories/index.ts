export { CategoriesModule } from './categories.module';
export { birthYearsFor, calculateAge, fullYears } from './domain/age';
export {
  type AthleteSnapshot,
  type CategoryRuleSpec,
  type CategorySpec,
  type EligibilityContext,
  type EligibilityResult,
  resolveEligibleCategories,
  weightBounds,
  weightFits,
} from './domain/eligibility';
