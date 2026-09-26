// Категории турнира из шаблона (API.md, 5.2): снимок границ возраста и веса на дату начала турнира.
import type { AgeCalculationPolicy, CategoryWeight, Gender, WeightLimitKind } from '@sde/contracts';
import { categoryWeightLabel } from '@sde/contracts';
import { birthYearsFor } from './age';
import { weightBounds } from './eligibility';

export interface TemplateAgeGroup {
  id: string;
  code: string;
  nameRu: string;
  nameEn: string;
  policy: AgeCalculationPolicy;
  ageFrom: number;
  ageTo: number;
}

export interface TemplateItem {
  ageGroup: TemplateAgeGroup;
  gender: Gender;
  weight: { kind: WeightLimitKind; limitGrams: number };
}

export interface GeneratedCategory {
  code: string;
  nameRu: string;
  nameEn: string;
  gender: Gender;
  ageGroupId: string;
  agePolicy: AgeCalculationPolicy;
  ageFrom: number;
  ageTo: number;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  weight: CategoryWeight;
  sortOrder: number;
}

const GENDER_WORD: Record<Gender, { ru: string; en: string; code: string }> = {
  MALE: { ru: 'Юноши', en: 'Boys', code: 'M' },
  FEMALE: { ru: 'Девушки', en: 'Girls', code: 'F' },
};

/** Код веса в коде категории: 38 кг → «38», 38,5 кг → «38_5», свыше 72 кг → «72+». */
function weightCode(w: CategoryWeight): string {
  const grams = w.kind === 'ABOVE' ? (w.lowerGrams ?? 0) : (w.upperGrams ?? 0);
  const kg = grams / 1000;
  const text = Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace('.', '_');
  return w.kind === 'ABOVE' ? `${text}+` : text;
}

/**
 * Категории из элементов шаблона: для каждой пары «возрастная группа × пол» пределы весов превращаются в
 * границы (—, 35], (35, 38], (38, —). Годы рождения для «по году рождения» считаются от года начала турнира.
 */
export function generateCategories(
  items: readonly TemplateItem[],
  competitionStartDate: string,
): GeneratedCategory[] {
  const year = Number(competitionStartDate.slice(0, 4));
  const groups = new Map<string, TemplateItem[]>();
  for (const i of items) {
    const key = `${i.ageGroup.id}:${i.gender}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const x = a[0] as TemplateItem;
    const y = b[0] as TemplateItem;
    return (
      x.ageGroup.ageFrom - y.ageGroup.ageFrom || (x.gender === y.gender ? 0 : x.gender === 'MALE' ? -1 : 1)
    );
  });
  const result: GeneratedCategory[] = [];
  for (const group of ordered) {
    const first = group[0] as TemplateItem;
    const ag = first.ageGroup;
    const limits = group.map((i) => i.weight);
    const bounds = weightBounds(limits);
    const years = ag.policy === 'EXACT_ON_DATE' ? null : birthYearsFor(ag.ageFrom, ag.ageTo, year);
    const withBounds = limits
      .map((l, idx) => ({ limit: l, bounds: bounds[idx] as CategoryWeight }))
      .sort((a, b) =>
        a.bounds.kind === b.bounds.kind
          ? a.limit.limitGrams - b.limit.limitGrams
          : a.bounds.kind === 'UP_TO'
            ? -1
            : 1,
      );
    for (const { bounds: w } of withBounds) {
      const g = GENDER_WORD[first.gender];
      result.push({
        code: `${g.code}-${ag.code}-${weightCode(w)}`,
        nameRu: `${g.ru} ${ag.nameRu}, ${categoryWeightLabel(w, 'ru')}`,
        nameEn: `${g.en} ${ag.nameEn}, ${categoryWeightLabel(w, 'en')}`,
        gender: first.gender,
        ageGroupId: ag.id,
        agePolicy: ag.policy,
        ageFrom: ag.ageFrom,
        ageTo: ag.ageTo,
        birthYearFrom: years?.from ?? null,
        birthYearTo: years?.to ?? null,
        weight: w,
        sortOrder: (result.length + 1) * 10,
      });
    }
  }
  return result;
}
