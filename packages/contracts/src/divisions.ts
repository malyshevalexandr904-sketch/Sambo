// Дивизионы спортсменов по возрасту (docs/RATED_ONLY.md, 4): каждый спортсмен принадлежит дивизиону по возрасту.
// Число дивизионов и их границы задаёт администратор платформы; дивизион не хранится у спортсмена, а вычисляется
// по дате рождения и правилу счёта возраста, поэтому с днём рождения или новым годом спортсмен переходит сам.
import { z } from 'zod';

/**
 * Как считать возраст для дивизиона:
 * - BY_BIRTH_YEAR — сколько лет исполняется в текущем году (текущий год − год рождения), как в спортивных правилах;
 * - EXACT_ON_DATE — полных лет на сегодня.
 */
export const DIVISION_AGE_POLICIES = ['BY_BIRTH_YEAR', 'EXACT_ON_DATE'] as const;
export type DivisionAgePolicy = (typeof DIVISION_AGE_POLICIES)[number];

const Age = z
  .number()
  .int({ error: 'out_of_range' })
  .min(0, { error: 'out_of_range' })
  .max(120, { error: 'out_of_range' });

const DivisionFields = {
  name: z.string().trim().min(1, { error: 'required' }).max(80, { error: 'too_long' }),
  /** Нижняя граница возраста включительно; пусто — без нижней границы. */
  minAge: Age.nullable(),
  /** Верхняя граница возраста включительно; пусто — без верхней границы. */
  maxAge: Age.nullable(),
  description: z.string().trim().max(500, { error: 'too_long' }).nullable().optional(),
};

const boundsIssue = (v: { minAge?: number | null; maxAge?: number | null }): boolean =>
  typeof v.minAge === 'number' && typeof v.maxAge === 'number' && v.minAge > v.maxAge;

export const DivisionCreate = z
  .object(DivisionFields)
  .refine((v) => !boundsIssue(v), { path: ['maxAge'], error: 'age_range_invalid' });
export type DivisionCreate = z.infer<typeof DivisionCreate>;

export const DivisionPatch = z
  .object(DivisionFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' })
  .refine((v) => !boundsIssue(v), { path: ['maxAge'], error: 'age_range_invalid' });
export type DivisionPatch = z.infer<typeof DivisionPatch>;

export const DivisionPolicyUpdate = z.object({ agePolicy: z.enum(DIVISION_AGE_POLICIES) });
export type DivisionPolicyUpdate = z.infer<typeof DivisionPolicyUpdate>;

export interface DivisionDto {
  id: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
  description: string | null;
  version: number;
}

export interface DivisionList {
  agePolicy: DivisionAgePolicy;
  /** По возрастанию нижней границы. */
  divisions: DivisionDto[];
}

/** Дивизион спортсмена и возраст, по которому он определён. */
export interface AthleteDivision {
  id: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
  age: number;
  agePolicy: DivisionAgePolicy;
}

/** Возраст по правилу дивизионов; даты — календарные `YYYY-MM-DD`. */
export function divisionAge(birthDate: string, today: string, policy: DivisionAgePolicy): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  if (policy === 'BY_BIRTH_YEAR') return ty - by;
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

type Range = { minAge: number | null; maxAge: number | null };

/** Возраст попадает в границы дивизиона (обе включительно, пустая — открыта). */
export function inDivision(d: Range, age: number): boolean {
  return (d.minAge === null || age >= d.minAge) && (d.maxAge === null || age <= d.maxAge);
}

/** Пересекаются ли границы двух дивизионов: спортсмен должен попадать не больше чем в один. */
export function divisionsOverlap(a: Range, b: Range): boolean {
  const lo = Math.max(a.minAge ?? 0, b.minAge ?? 0);
  const hi = Math.min(a.maxAge ?? Number.POSITIVE_INFINITY, b.maxAge ?? Number.POSITIVE_INFINITY);
  return lo <= hi;
}

/** Дивизион по возрасту; возраст вне всех дивизионов — null. */
export function divisionFor<D extends Range>(divisions: readonly D[], age: number): D | null {
  return divisions.find((d) => inDivision(d, age)) ?? null;
}
