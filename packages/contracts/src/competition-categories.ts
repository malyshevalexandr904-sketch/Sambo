// Категории турнира (API.md, 5.2; DATABASE.md, 3.4; ARCHITECTURE.md, 16.2): снимок границ возраста и веса,
// ручное добавление, переходы и объединение.
import { z } from 'zod';
import {
  AGE_POLICIES,
  type AgeCalculationPolicy,
  WEIGHT_LIMIT_KINDS,
  type WeightLimitKind,
} from './categories.js';
import { Grams, LocalDate, type LocalizedText, Reason, Uuid } from './common.js';
import { CATEGORY_STATUSES, type CategoryStatus } from './competitions.js';
import { GENDERS, type Gender } from './people.js';
import { COMPETITION_FORMAT_CODES, type CompetitionFormatCode } from './rulesets.js';

/** Значение задано (не `null` и не `undefined`). */
const has = (x: number | null | undefined): x is number => x !== null && x !== undefined;

const CategoryCode = z.string().regex(/^[A-Z0-9][A-Z0-9_+-]{1,39}$/, { error: 'invalid_code' });
const Age = z.number().int().min(5).max(99);
const Year = z.number().int().min(1950).max(2100);
const LocalizedName = z.object({
  ru: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
});

export const CategoryAgeInput = z
  .object({
    policy: z.enum(AGE_POLICIES),
    ageFrom: Age.nullable().optional(),
    ageTo: Age.nullable().optional(),
    birthYearFrom: Year.nullable().optional(),
    birthYearTo: Year.nullable().optional(),
    referenceDate: LocalDate.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.policy === 'BIRTH_YEAR_RANGE') {
      if (!has(v.birthYearFrom) && !has(v.birthYearTo))
        ctx.addIssue({ code: 'custom', path: ['birthYearFrom'], message: 'required' });
      if (has(v.birthYearFrom) && has(v.birthYearTo) && v.birthYearFrom > v.birthYearTo)
        ctx.addIssue({ code: 'custom', path: ['birthYearTo'], message: 'range_invalid' });
    } else {
      if (!has(v.ageFrom) && !has(v.ageTo))
        ctx.addIssue({ code: 'custom', path: ['ageFrom'], message: 'required' });
      if (has(v.ageFrom) && has(v.ageTo) && v.ageFrom > v.ageTo)
        ctx.addIssue({ code: 'custom', path: ['ageTo'], message: 'age_range_invalid' });
    }
  });
export type CategoryAgeInput = z.infer<typeof CategoryAgeInput>;

export const CategoryWeightInput = z
  .object({
    kind: z.enum(WEIGHT_LIMIT_KINDS),
    lowerGrams: Grams.nullable().optional(),
    upperGrams: Grams.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ABOVE') {
      if (!has(v.lowerGrams)) ctx.addIssue({ code: 'custom', path: ['lowerGrams'], message: 'required' });
      if (has(v.upperGrams)) ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'not_allowed' });
    } else {
      if (!has(v.upperGrams)) ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'required' });
      if (has(v.lowerGrams) && has(v.upperGrams) && v.lowerGrams >= v.upperGrams)
        ctx.addIssue({ code: 'custom', path: ['upperGrams'], message: 'weight_range_invalid' });
    }
  });
export type CategoryWeightInput = z.infer<typeof CategoryWeightInput>;

export const CategoryInput = z.object({
  code: CategoryCode,
  name: LocalizedName,
  gender: z.enum(GENDERS),
  ageGroupId: Uuid.nullable().optional(),
  age: CategoryAgeInput,
  weight: CategoryWeightInput,
  formatOverride: z.enum(COMPETITION_FORMAT_CODES).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const CategoryPatch = z
  .object({
    code: CategoryCode,
    name: LocalizedName,
    age: CategoryAgeInput,
    weight: CategoryWeightInput,
    formatOverride: z.enum(COMPETITION_FORMAT_CODES).nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type CategoryPatch = z.infer<typeof CategoryPatch>;

export const CategoriesQuery = z.object({
  gender: z.enum(GENDERS).optional(),
  ageGroupId: Uuid.optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type CategoriesQuery = z.infer<typeof CategoriesQuery>;

export const CategoryGenerateRequest = z.object({
  templateId: Uuid,
  /** Заменить все категории турнира (только пока в нём нет участий). */
  replaceExisting: z.boolean().default(false),
});
export type CategoryGenerateRequest = z.infer<typeof CategoryGenerateRequest>;

export const CategoryTransitionRequest = z.object({
  to: z.enum(CATEGORY_STATUSES),
  reason: Reason.optional(),
});
export type CategoryTransitionRequest = z.infer<typeof CategoryTransitionRequest>;

export const CategoryMergeRequest = z
  .object({
    sourceCategoryIds: z.array(Uuid).min(1).max(10),
    targetCategoryId: Uuid,
    reason: Reason,
  })
  .refine((v) => !v.sourceCategoryIds.includes(v.targetCategoryId), {
    error: 'target_in_sources',
    path: ['targetCategoryId'],
  })
  .refine((v) => new Set(v.sourceCategoryIds).size === v.sourceCategoryIds.length, {
    error: 'duplicate_ids',
    path: ['sourceCategoryIds'],
  });
export type CategoryMergeRequest = z.infer<typeof CategoryMergeRequest>;

export interface CategoryAge {
  policy: AgeCalculationPolicy;
  ageFrom: number | null;
  ageTo: number | null;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  referenceDate: string | null;
}

export interface CategoryWeight {
  kind: WeightLimitKind;
  lowerGrams: number | null;
  upperGrams: number | null;
}

export interface CategoryRef {
  id: string;
  code: string;
  name: LocalizedText;
}

export interface CompetitionCategoryDto extends CategoryRef {
  competitionId: string;
  gender: Gender;
  ageGroupId: string | null;
  age: CategoryAge;
  weight: CategoryWeight;
  formatOverride: CompetitionFormatCode | null;
  status: CategoryStatus;
  mergedIntoId: string | null;
  sortOrder: number;
  /** Действующие участия (не отклонённые и не снятые) и одобренные. */
  entries: { active: number; approved: number };
  version: number;
  allowedActions: string[];
}

/** Подпись веса категории: «до 38 кг», «свыше 72 кг» (UP_TO без верхней границы не бывает). */
export function categoryWeightLabel(w: CategoryWeight, locale: 'ru' | 'en'): string {
  const kg = (g: number): string => {
    const v = g / 1000;
    const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return locale === 'ru' ? text.replace('.', ',') : text;
  };
  if (w.kind === 'ABOVE')
    return locale === 'ru' ? `свыше ${kg(w.lowerGrams ?? 0)} кг` : `over ${kg(w.lowerGrams ?? 0)} kg`;
  return locale === 'ru' ? `до ${kg(w.upperGrams ?? 0)} кг` : `up to ${kg(w.upperGrams ?? 0)} kg`;
}
