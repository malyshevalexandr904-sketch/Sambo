// Стадии проведения турнира (правки 05.11.2026): как статусы заявки и турнира видят организатор, администратор и
// посетитель публичной страницы, какие разделы открыты на публичной странице и шаблоны афиши.
import { z } from 'zod';
import { Uuid } from './common.js';
import type { CompetitionStatus } from './competitions.js';

/**
 * Стадии по порядку: «Черновик» и «На согласовании» — у заявки на проведение (и у турнира, пока организатор его
 * не опубликовал), остальные — у опубликованного турнира.
 */
export const TOURNAMENT_STAGES = [
  'DRAFT',
  'REVIEW',
  'PUBLISHED',
  'REGISTRATION',
  'MANDATE',
  'WEIGH_IN',
  'DRAW',
  'LIVE',
  'FINISHED',
] as const;
export type TournamentStage = (typeof TOURNAMENT_STAGES)[number];

/** Стадия турнира по статусу; отменённый турнир — null. */
export function stageOfCompetition(status: CompetitionStatus): TournamentStage | null {
  switch (status) {
    case 'DRAFT':
      return 'REVIEW';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'REGISTRATION_OPEN':
      return 'REGISTRATION';
    case 'REGISTRATION_CLOSED':
      return 'MANDATE';
    case 'CHECK_IN':
      return 'WEIGH_IN';
    case 'DRAWING':
    case 'SCHEDULED':
      return 'DRAW';
    case 'IN_PROGRESS':
      return 'LIVE';
    case 'FINISHED':
    case 'ARCHIVED':
      return 'FINISHED';
    case 'CANCELLED':
      return null;
  }
}

/** Разделы публичной страницы турнира. */
export const PUBLIC_SECTIONS = ['poster', 'regulation', 'registration', 'brackets', 'live', 'media'] as const;
export type PublicSection = (typeof PUBLIC_SECTIONS)[number];

/**
 * Какие разделы открыты на публичной странице на каждой стадии. Регистрация: «скоро» на стадии «Опубликован»,
 * открыта на «Регистрации», закрыта дальше; сетки и трансляция появляются с жеребьёвки; медиа — после завершения.
 */
export function publicSectionsOf(status: CompetitionStatus): PublicSection[] {
  const stage = stageOfCompetition(status);
  switch (stage) {
    case 'PUBLISHED':
    case 'REGISTRATION':
    case 'MANDATE':
    case 'WEIGH_IN':
      return ['poster', 'regulation', 'registration'];
    case 'DRAW':
    case 'LIVE':
      return ['poster', 'regulation', 'registration', 'brackets', 'live'];
    case 'FINISHED':
      return ['poster', 'regulation', 'brackets', 'media'];
    default:
      return ['poster', 'regulation'];
  }
}

/** Шаблоны афиши: оформление постера на публичной странице (выбирает администратор). */
export const POSTER_TEMPLATES = ['classic', 'arena', 'minimal', 'sunrise'] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];
export const isPosterTemplate = (v: string): v is PosterTemplate =>
  (POSTER_TEMPLATES as readonly string[]).includes(v);

const HttpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => v.startsWith('https://'), { error: 'https_required' });

/** Оформление публичной страницы: шаблон афиши и ссылка на прямую трансляцию. */
export const CompetitionPresentationUpdate = z.object({
  posterTemplate: z.enum(POSTER_TEMPLATES).optional(),
  liveStreamUrl: HttpsUrl.nullable().optional(),
});
export type CompetitionPresentationUpdate = z.infer<typeof CompetitionPresentationUpdate>;

// ---- Медиа завершённого турнира ----

export const COMPETITION_MEDIA_KINDS = ['PHOTO', 'VIDEO'] as const;
export type CompetitionMediaKind = (typeof COMPETITION_MEDIA_KINDS)[number];

export const CompetitionMediaCreate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PHOTO'), fileId: Uuid, caption: z.string().trim().max(200).optional() }),
  z.object({ kind: z.literal('VIDEO'), url: HttpsUrl, caption: z.string().trim().max(200).optional() }),
]);
export type CompetitionMediaCreate = z.infer<typeof CompetitionMediaCreate>;

export interface CompetitionMediaDto {
  id: string;
  kind: CompetitionMediaKind;
  /** Фото — адрес файла, видео — ссылка на ролик. */
  url: string;
  caption: string | null;
  createdAt: string;
}

/** Подписка на начало регистрации турнира. */
export interface CompetitionFollowDto {
  followed: boolean;
}
