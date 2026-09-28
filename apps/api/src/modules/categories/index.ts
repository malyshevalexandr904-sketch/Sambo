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
export { isActiveCategory, MERGEABLE } from './domain/category-machine';
export {
  CategoryExtensions,
  type CategoryMergeHandler,
  type CategoryTransitionCheck,
  type EntryStats,
} from './application/category-extensions';
export { CompetitionCategoriesService } from './application/competition-categories.service';
export { CategoryWorkflowService, type LockedCategory } from './application/category-workflow';
export type { CategoryRow } from './application/category-mapper';
export { CompetitionRulesService } from './application/competition-rules.service';
export type { CompetitionCategorySpec } from './application/category-mapper';
