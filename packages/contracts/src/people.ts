// People (API.md, 3.2, 4.1, 4.3; DATABASE.md, 3.3): человек, профили тренера и судьи.
import { z } from 'zod';
import { CountryCode, LocalDate, type LocalizedText, PageQuery, PersonName, Uuid } from './common.js';

export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

/** Статус профиля (спортсмен, тренер, судья) и справочных наборов правил. */
export const PROFILE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Полных лет на дату (даты — YYYY-MM-DD). День рождения засчитывается в тот же день. Родившийся 29 февраля
 * в невисокосный год считается достигшим возраста 28 февраля: срок, исчисляемый годами, истекает в последний
 * день месяца, если соответствующего числа в нём нет (ГК РФ, ст. 192, п. 3).
 */
export function fullYearsOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = onDate.split('-').map(Number) as [number, number, number];
  const birthdayDay = bm === 2 && bd === 29 && !isLeapYear(ry) ? 28 : bd;
  const hadBirthday = rm > bm || (rm === bm && rd >= birthdayDay);
  return ry - by - (hadBirthday ? 0 : 1);
}

/** Совершеннолетие — 18 полных лет: сам спортсмен даёт и отзывает согласия. */
export const isAdultOn = (birthDate: string, onDate: string = todayIso()): boolean =>
  fullYearsOn(birthDate, onDate) >= 18;

const BirthDate = LocalDate.refine((d) => d > '1900-01-01' && d <= todayIso(), {
  error: 'birth_date_out_of_range',
});

/** Возраст спортсмена по году рождения — от 5 до 25 лет (API.md, 4.1). */
export function athleteBirthDateInRange(birthDate: string, today: string = todayIso()): boolean {
  const age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return birthDate <= today && age >= 5 && age <= 25;
}

const AthleteBirthDate = LocalDate.refine((d) => athleteBirthDateInRange(d), {
  error: 'birth_date_out_of_range',
});

const City = z.string().trim().max(100);

export const PersonInput = z.object({
  lastName: PersonName,
  firstName: PersonName,
  middleName: PersonName.optional(),
  birthDate: BirthDate,
  gender: z.enum(GENDERS),
  countryCode: CountryCode.optional(),
  regionId: Uuid.optional(),
  city: City.optional(),
});
export type PersonInput = z.infer<typeof PersonInput>;

/** Данные человека-спортсмена: возраст 5–25 лет. */
export const AthletePersonInput = PersonInput.extend({ birthDate: AthleteBirthDate });
export type AthletePersonInput = z.infer<typeof AthletePersonInput>;

/** Частичное изменение: `null` очищает необязательное поле. */
export const PersonPatch = z
  .object({
    lastName: PersonName,
    firstName: PersonName,
    middleName: PersonName.nullable(),
    birthDate: BirthDate,
    gender: z.enum(GENDERS),
    countryCode: CountryCode.nullable(),
    regionId: Uuid.nullable(),
    city: City.nullable(),
  })
  .partial();
export type PersonPatch = z.infer<typeof PersonPatch>;

export const AthletePersonPatch = PersonPatch.extend({ birthDate: AthleteBirthDate.optional() });
export type AthletePersonPatch = z.infer<typeof AthletePersonPatch>;

export const UpsertMyPersonRequest = PersonInput.extend({
  /** Пользователь подтверждает, что похожая запись — не он (API.md, 3.2: POSSIBLE_DUPLICATE). */
  confirmNotDuplicate: z.boolean().optional(),
});
export type UpsertMyPersonRequest = z.infer<typeof UpsertMyPersonRequest>;

export interface PersonDto {
  id: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: Gender;
  countryCode: string | null;
  regionId: string | null;
  city: string | null;
}

/** Публичное имя по решению Q-04: «Фамилия И.». */
export function publicName(lastName: string, firstName: string): string {
  const initial = firstName.trim().charAt(0).toUpperCase();
  return initial ? `${lastName.trim()} ${initial}.` : lastName.trim();
}

/** Полное имя для служебных экранов: «Фамилия Имя Отчество». */
export function fullName(p: { lastName: string; firstName: string; middleName?: string | null }): string {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ');
}

export interface PersonRef {
  id: string;
  name: string;
}

// ---- Тренеры (API.md, 4.3) ----

/** Профиль создаётся для пользователя (`userId`) или для человека без аккаунта (`person`). */
const personOrUser = (v: { userId?: string; person?: unknown }): boolean =>
  (v.userId === undefined) !== (v.person === undefined);
const PERSON_OR_USER = { error: 'user_or_person_required', path: ['person'] };

export const CoachCreate = z
  .object({
    userId: Uuid.optional(),
    person: PersonInput.optional(),
    /** Похожие люди уже есть: создать нового всё равно. */
    confirmNotDuplicate: z.boolean().optional(),
    organizationId: Uuid,
  })
  .refine(personOrUser, PERSON_OR_USER);
export type CoachCreate = z.infer<typeof CoachCreate>;

export const CoachPatch = z.object({ status: z.enum(PROFILE_STATUSES) });
export type CoachPatch = z.infer<typeof CoachPatch>;

export const CoachMembershipEnd = z.object({ organizationId: Uuid });
export type CoachMembershipEnd = z.infer<typeof CoachMembershipEnd>;

export const CoachesQuery = PageQuery.extend({
  organizationId: Uuid.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
});
export type CoachesQuery = z.infer<typeof CoachesQuery>;

export interface CoachSummary {
  id: string;
  personId: string;
  name: string;
  publicName: string;
  userId: string | null;
  status: ProfileStatus;
  organizations: { id: string; shortName: string }[];
  version: number;
}

// ---- Судьи (API.md, 4.3) ----

export const RefereeCreate = z
  .object({
    userId: Uuid.optional(),
    person: PersonInput.optional(),
    confirmNotDuplicate: z.boolean().optional(),
    refereeCategoryCode: z.string().min(2).max(40),
    categoryAssignedAt: LocalDate.optional(),
  })
  .refine(personOrUser, PERSON_OR_USER);
export type RefereeCreate = z.infer<typeof RefereeCreate>;

export const RefereePatch = z
  .object({
    refereeCategoryCode: z.string().min(2).max(40),
    categoryAssignedAt: LocalDate.nullable(),
    status: z.enum(PROFILE_STATUSES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'empty_patch' });
export type RefereePatch = z.infer<typeof RefereePatch>;

export const RefereesQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  categoryCode: z.string().max(40).optional(),
  regionId: Uuid.optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
});
export type RefereesQuery = z.infer<typeof RefereesQuery>;

export interface RefereeSummary {
  id: string;
  personId: string;
  name: string;
  userId: string | null;
  regionId: string | null;
  category: { code: string; name: LocalizedText };
  categoryAssignedAt: string | null;
  status: ProfileStatus;
  version: number;
}
