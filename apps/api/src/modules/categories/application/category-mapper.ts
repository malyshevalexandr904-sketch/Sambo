// Представление категории турнира в ответах API и её границы для доменных функций.
import type { CategoryAge, CategoryWeight, CompetitionCategoryDto } from '@sde/contracts';
import type { CompetitionCategory } from '@sde/db';
import type { CategorySpec } from '../domain/eligibility';
import type { EntryStats } from './category-extensions';

export type CategoryRow = CompetitionCategory;

export function boundsOf(c: CategoryRow): { age: CategoryAge; weight: CategoryWeight } {
  return {
    age: {
      policy: c.agePolicy,
      ageFrom: c.ageFrom,
      ageTo: c.ageTo,
      birthYearFrom: c.birthYearFrom,
      birthYearTo: c.birthYearTo,
      referenceDate: c.ageReferenceDate ? c.ageReferenceDate.toISOString().slice(0, 10) : null,
    },
    weight: { kind: c.weightKind, lowerGrams: c.weightLowerGrams, upperGrams: c.weightUpperGrams },
  };
}

export function toCategoryDto(
  c: CategoryRow,
  stats: EntryStats,
  allowedActions: string[],
): CompetitionCategoryDto {
  return {
    id: c.id,
    code: c.code,
    name: { ru: c.nameRu, en: c.nameEn },
    competitionId: c.competitionId,
    gender: c.gender,
    ageGroupId: c.ageGroupId,
    ...boundsOf(c),
    formatOverride: c.formatOverride,
    status: c.status,
    mergedIntoId: c.mergedIntoId,
    sortOrder: c.sortOrder,
    entries: { active: stats.active, approved: stats.approved },
    version: c.version,
    allowedActions,
  };
}

/** Категория для расчёта совместимости (ARCHITECTURE.md, 14.2). */
export interface CompetitionCategorySpec extends CategorySpec {
  competitionId: string;
  code: string;
  name: { ru: string; en: string };
  status: CompetitionCategory['status'];
}

export function toSpec(c: CategoryRow): CompetitionCategorySpec {
  const b = boundsOf(c);
  return {
    id: c.id,
    competitionId: c.competitionId,
    code: c.code,
    name: { ru: c.nameRu, en: c.nameEn },
    status: c.status,
    gender: c.gender,
    age: b.age,
    weight: b.weight,
  };
}
