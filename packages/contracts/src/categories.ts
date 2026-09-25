// Возрастные группы, весовые категории, шаблоны наборов категорий, правила допуска (API.md, 4.5; DATABASE.md, 3.4).
import { z } from 'zod';
import { Grams, type LocalizedText, Uuid } from './common.js';
import type { OrganizationRef } from './organizations.js';
import { GENDERS, type Gender } from './people.js';

/** Способ расчёта возраста; по умолчанию — по году рождения (решение Q-03). */
export const AGE_POLICIES = ['BY_BIRTH_YEAR', 'EXACT_ON_DATE', 'BIRTH_YEAR_RANGE'] as const;
export type AgeCalculationPolicy = (typeof AGE_POLICIES)[number];

/** «до N кг» или «свыше N кг». */
export const WEIGHT_LIMIT_KINDS = ['UP_TO', 'ABOVE'] as const;
export type WeightLimitKind = (typeof WEIGHT_LIMIT_KINDS)[number];

const GroupCode = z.string().regex(/^[A-Z0-9_]{2,30}$/, { error: 'invalid_code' });
const Age = z.number().int().min(5).max(99);
const LocalizedName = z.object({
  ru: z.string().trim().min(1).max(100),
  en: z.string().trim().min(1).max(100),
});

/** Владелец справочной записи: `platform` — шаблоны платформы, иначе — id организации. */
export const OwnerFilter = z.union([z.literal('platform'), Uuid]);

export const AgeGroupsQuery = z.object({
  disciplineCode: z.string().max(40).optional(),
  owner: OwnerFilter.optional(),
});
export type AgeGroupsQuery = z.infer<typeof AgeGroupsQuery>;

export const AgeGroupInput = z
  .object({
    disciplineCode: z.string().min(2).max(40),
    code: GroupCode,
    name: LocalizedName,
    policy: z.enum(AGE_POLICIES).default('BY_BIRTH_YEAR'),
    ageFrom: Age,
    ageTo: Age,
    ownerOrganizationId: Uuid.optional(),
  })
  .refine((v) => v.ageFrom <= v.ageTo, { error: 'age_range_invalid', path: ['ageTo'] });
export type AgeGroupInput = z.infer<typeof AgeGroupInput>;

export const AgeGroupPatch = z
  .object({ name: LocalizedName, policy: z.enum(AGE_POLICIES), ageFrom: Age, ageTo: Age })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' })
  .refine((v) => v.ageFrom === undefined || v.ageTo === undefined || v.ageFrom <= v.ageTo, {
    error: 'age_range_invalid',
    path: ['ageTo'],
  });
export type AgeGroupPatch = z.infer<typeof AgeGroupPatch>;

export interface WeightCategoryDto {
  id: string;
  ageGroupId: string;
  gender: Gender;
  kind: WeightLimitKind;
  limitGrams: number;
  sortOrder: number;
}

export interface AgeGroupDto {
  id: string;
  disciplineCode: string;
  owner: OrganizationRef | null;
  code: string;
  name: LocalizedText;
  policy: AgeCalculationPolicy;
  ageFrom: number;
  ageTo: number;
  weightCategories: WeightCategoryDto[];
  allowedActions: string[];
}

export const WeightCategoriesQuery = z.object({ ageGroupId: Uuid.optional() });

export const WeightCategoryInput = z.object({
  ageGroupId: Uuid,
  gender: z.enum(GENDERS),
  kind: z.enum(WEIGHT_LIMIT_KINDS),
  limitGrams: Grams,
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type WeightCategoryInput = z.infer<typeof WeightCategoryInput>;

export const WeightCategoryPatch = z
  .object({
    kind: z.enum(WEIGHT_LIMIT_KINDS),
    limitGrams: Grams,
    sortOrder: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type WeightCategoryPatch = z.infer<typeof WeightCategoryPatch>;

export const CategoryTemplatesQuery = z.object({
  disciplineCode: z.string().max(40).optional(),
  owner: OwnerFilter.optional(),
});

const TemplateItems = z
  .array(
    z.object({
      ageGroupId: Uuid,
      gender: z.enum(GENDERS),
      weightCategoryIds: z.array(Uuid).min(1).max(40),
    }),
  )
  .min(1)
  .max(40);

export const CategoryTemplateInput = z.object({
  name: z.string().trim().min(2).max(200),
  disciplineCode: z.string().min(2).max(40),
  ownerOrganizationId: Uuid.optional(),
  items: TemplateItems,
});
export type CategoryTemplateInput = z.infer<typeof CategoryTemplateInput>;

export const CategoryTemplatePatch = z
  .object({ name: z.string().trim().min(2).max(200), items: TemplateItems })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type CategoryTemplatePatch = z.infer<typeof CategoryTemplatePatch>;

export interface CategoryTemplateDto {
  id: string;
  name: string;
  disciplineCode: string;
  owner: OrganizationRef | null;
  items: { ageGroupId: string; ageGroupCode: string; gender: Gender; weightCategoryIds: string[] }[];
  categoryCount: number;
  allowedActions: string[];
}

// ---- Правила допуска к категории (используются с Phase 4: CategoryRule) ----

export const CATEGORY_RULE_KINDS = [
  'MIN_RANK',
  'MAX_RANK',
  'ALLOW_YOUNGER',
  'MAX_CATEGORIES_PER_ATHLETE',
  'REGION_ONLY',
] as const;
export type CategoryRuleKind = (typeof CATEGORY_RULE_KINDS)[number];

export const CATEGORY_RULE_PARAMS = {
  MIN_RANK: z.object({ sportRankCode: z.string().min(2).max(40) }),
  MAX_RANK: z.object({ sportRankCode: z.string().min(2).max(40) }),
  ALLOW_YOUNGER: z.object({ years: z.number().int().min(1).max(3) }),
  MAX_CATEGORIES_PER_ATHLETE: z.object({ max: z.number().int().min(1).max(10) }),
  REGION_ONLY: z.object({ regionIds: z.array(Uuid).min(1).max(100) }),
} as const satisfies Record<CategoryRuleKind, z.ZodType>;

/** Причины несовместимости категории: UI показывает их текстом, но сам совместимость не считает (ADR-02). */
export const ELIGIBILITY_REASONS = [
  'GENDER_MISMATCH',
  'AGE_BELOW_MIN',
  'AGE_ABOVE_MAX',
  'BIRTH_YEAR_OUT_OF_RANGE',
  'RANK_REQUIRED',
  'RANK_TOO_LOW',
  'RANK_TOO_HIGH',
  'REGION_NOT_ALLOWED',
  'MAX_CATEGORIES_REACHED',
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/** Подпись весовой категории: «до 38 кг», «свыше 72 кг», «38,5 кг». */
export function weightLabelKg(limitGrams: number, locale: 'ru' | 'en'): string {
  const kg = limitGrams / 1000;
  const text = Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
  return locale === 'ru' ? text.replace('.', ',') : text;
}
