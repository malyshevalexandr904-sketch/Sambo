// Публичная витрина турнира (API.md, 5.9; ADR-15): белый список полей, без персональных данных.
import { z } from 'zod';
import { LocalDate, type LocalizedText, PageQuery, Uuid } from './common.js';
import type { CategoryAge, CategoryWeight } from './competition-categories.js';
import {
  type CategoryStatus,
  type CompetitionContactInfo,
  type CompetitionLevel,
  type CompetitionStatus,
  type CompetitionType,
  PUBLIC_COMPETITION_STATUSES,
  type RequirementKind,
} from './competitions.js';
import type { Gender } from './people.js';

export const PublicCompetitionsQuery = PageQuery.extend({
  status: z.enum(PUBLIC_COMPETITION_STATUSES as [CompetitionStatus, ...CompetitionStatus[]]).optional(),
  regionId: Uuid.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});
export type PublicCompetitionsQuery = z.infer<typeof PublicCompetitionsQuery>;

export interface PublicCompetitionSummary {
  slug: string;
  name: string;
  shortName: string | null;
  status: CompetitionStatus;
  level: CompetitionLevel;
  startDate: string;
  endDate: string;
  timezone: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
  registrationOpenNow: boolean;
  organizerName: string;
  city: string | null;
  regionName: LocalizedText | null;
  logoUrl: string | null;
}

export interface PublicCompetitionCategory {
  code: string;
  name: LocalizedText;
  gender: Gender;
  age: CategoryAge;
  weight: CategoryWeight;
  status: CategoryStatus;
  /** Одобренные участия. */
  participants: number;
}

export interface PublicCompetition extends PublicCompetitionSummary {
  descriptionMd: string | null;
  discipline: LocalizedText;
  venue: { name: string; address: string | null; city: string | null } | null;
  /** Положение, загруженное администратором (PDF). */
  regulationUrl: string | null;
  /** Фирменное положение «Цифровое Самбо», собранное платформой по данным турнира (`?download=1` — скачать). */
  generatedRegulationPdfUrl: string;
  /** Что показывать в разделе «Положение»: загруженный PDF, а если его нет — сформированный платформой. */
  regulationPdfUrl: string;
  requirementsMd: string | null;
  requirements: {
    kind: RequirementKind;
    categoryCode: string | null;
    documentType: LocalizedText | null;
    consentKind: string | null;
    mandatory: boolean;
    noteMd: string | null;
  }[];
  categories: PublicCompetitionCategory[];
  contacts: CompetitionContactInfo | null;
  cancelReason: string | null;
  competitionType: CompetitionType;
  /** Рейтинговый турнир показывает изменения рейтинга публично (`rating-summary`, `rated-matches`). */
  ratingPublic: boolean;
  /** Афиша (правки 05.11.2026): шаблон оформления, окна взвешивания для регламента, ссылка на трансляцию. */
  posterTemplate: string;
  weighInWindows: { name: string; startsAt: string; endsAt: string }[];
  liveStreamUrl: string | null;
}

/** Участник публичной сетки: имя — только с согласием на распространение ПДн, иначе null. */
export interface PublicBracketParticipant {
  entryId: string;
  name: string | null;
  club: string | null;
  region: string | null;
}

/** Схватка публичной сетки (узел сетки опубликованной жеребьёвки). */
export interface PublicBracketMatch {
  key: string;
  stage: string;
  group: string | null;
  round: number;
  position: number;
  label: string;
  red: string | null;
  blue: string | null;
  winner: 'RED' | 'BLUE' | null;
  status: string;
  score: string | null;
}

/** Итоговый протокол категории: места участников по опубликованным итогам. */
export interface PublicPlacement {
  place: number;
  medal: 'GOLD' | 'SILVER' | 'BRONZE' | null;
  entryId: string;
  wins: number;
  losses: number;
}

export interface PublicCategoryBracket {
  code: string;
  name: LocalizedText;
  gender: Gender;
  weight: CategoryWeight;
  format: string | null;
  participants: PublicBracketParticipant[];
  matches: PublicBracketMatch[];
  /** Опубликованные итоги категории; null — итогов ещё нет. */
  placements: PublicPlacement[] | null;
}

export interface PublicBracketsDto {
  categories: PublicCategoryBracket[];
}

/** Прямая трансляция: ссылка на видео и табло ковров. */
export interface PublicLiveDto {
  streamUrl: string | null;
  mats: { id: string; number: number; name: string | null }[];
}

/** Адрес фирменного положения турнира в публичном API (тот же сайт; `?download=1` — скачать файлом). */
export function publicRegulationPdfPath(slug: string): string {
  return `/api/public/v1/competitions/${encodeURIComponent(slug)}/regulation.pdf`;
}
