// Поиск участников платформы и их страницы (правки 07.11.2026, п. 7, 8, 10): любой вошедший пользователь находит
// другого по ФИО и открывает его страницу — то же, что тот видит в своём личном кабинете. Только для вошедших:
// страницы не индексируются и не видны гостям (152-ФЗ). Контакты (почта, телефон) и дата рождения не показываются.
import { z } from 'zod';
import type { CabinetRole } from './cabinet-roles.js';
import type { LocalizedText } from './common.js';
import type { AthleteRatingProgress } from './rating.js';
import type { AthleteHistoryDto } from './results.js';

/** Роли на странице участника: четыре роли платформы. */
export const PUBLIC_PROFILE_ROLES = [
  'ORGANIZATION_HEAD',
  'COACH',
  'REFEREE',
  'ATHLETE',
] as const satisfies readonly CabinetRole[];
export type PublicProfileRole = (typeof PUBLIC_PROFILE_ROLES)[number];

export const UserSearchQuery = z.object({
  q: z.string().trim().min(2, { error: 'too_short' }).max(100, { error: 'too_long' }),
});
export type UserSearchQuery = z.infer<typeof UserSearchQuery>;

export interface UserSearchItem {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roles: PublicProfileRole[];
  city: string | null;
}

/** Рейтинг судьи: среднее арифметическое оценок организаторов (1–5 звёзд), округлённое до десятых. */
export interface RefereeRatingSummary {
  average: number | null;
  count: number;
}

export interface RefereeStatsDto {
  categoryCode: string | null;
  categoryName: LocalizedText | null;
  /** Год начала судейской практики и стаж в полных годах; null — судья ещё не указал. */
  sinceYear: number | null;
  experienceYears: number | null;
  /** Завершённые турниры, в которых участник работал судьёй (или в другой судейской роли). */
  tournaments: number;
  rating: RefereeRatingSummary;
}

export interface UserProfileDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roles: PublicProfileRole[];
  /** Полных лет; дату рождения страница не показывает. */
  age: number | null;
  city: string | null;
  /** Организации, где участник — руководитель, тренер или спортсмен. */
  organizations: { id: string; name: string }[];
  athlete: {
    athleteId: string;
    club: string | null;
    coach: string | null;
    rankCode: string | null;
    progress: AthleteRatingProgress;
    history: AthleteHistoryDto;
  } | null;
  coach: { athletes: number } | null;
  head: { coaches: number; athletes: number } | null;
  referee: RefereeStatsDto | null;
  /** Это страница самого смотрящего. */
  self: boolean;
}

/** Судья указывает год начала судейской практики (стаж на его странице). */
export const RefereeExperiencePut = z.object({
  sinceYear: z
    .number()
    .int()
    .min(1950, { error: 'too_small' })
    .max(new Date().getUTCFullYear(), { error: 'too_big' })
    .nullable(),
});
export type RefereeExperiencePut = z.infer<typeof RefereeExperiencePut>;

/** Оценка судьи организатором турнира: 1–5 звёзд. */
export const RefereeRatingPut = z.object({ stars: z.number().int().min(1).max(5) });
export type RefereeRatingPut = z.infer<typeof RefereeRatingPut>;

/** Оценки судей турнира: кого можно оценить и какие оценки уже поставлены. */
export interface CompetitionRefereeRatingDto {
  userId: string;
  name: string;
  stars: number | null;
}

/** Оценки можно ставить, когда турнир идёт или завершён (судьи уже отработали). */
export const REFEREE_RATING_STATUSES = ['IN_PROGRESS', 'FINISHED', 'ARCHIVED'] as const;

export function experienceYears(sinceYear: number | null, today: string): number | null {
  if (sinceYear === null) return null;
  return Math.max(0, Number(today.slice(0, 4)) - sinceYear);
}

/** Среднее арифметическое до десятых. */
export function averageStars(stars: readonly number[]): number | null {
  if (stars.length === 0) return null;
  return Math.round((stars.reduce((s, x) => s + x, 0) / stars.length) * 10) / 10;
}
