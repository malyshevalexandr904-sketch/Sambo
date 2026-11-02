// Заявки организаций на проведение турнира (docs/RATED_ONLY.md, 2): турнир создаёт только платформа, организация
// подаёт заявку с предлагаемыми сроками и местом. Одобрение создаёт черновик рейтингового турнира по заявке.
import { z } from 'zod';
import { E164, Email, type LocalizedText, PageQuery, Reason, Uuid } from './common.js';
import { type CompetitionLevel, CompetitionFields, scheduleIssues, type VenueRef } from './competitions.js';
import type { OrganizationRef } from './organizations.js';
import { RefereeRecruitmentInput } from './referee-recruitment-input.js';

export const COMPETITION_REQUEST_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type CompetitionRequestStatus = (typeof COMPETITION_REQUEST_STATUSES)[number];

/** Наличие материально-технической базы и судейской бригады у организатора. */
export const HOSTING_AVAILABILITY = ['FULL', 'PARTIAL', 'NONE'] as const;
export type HostingAvailability = (typeof HOSTING_AVAILABILITY)[number];

/** Пол участников: только мальчики, только девочки, вместе или раздельно. */
export const HOSTING_GENDERS = ['BOYS', 'GIRLS', 'MIXED', 'SEPARATE'] as const;
export type HostingGender = (typeof HOSTING_GENDERS)[number];

/** Сколько возрастных категорий можно выбрать в заявке. */
export const HOSTING_MAX_AGE_GROUPS = 2;
export const HOSTING_MAX_MATS = 20;

/**
 * Минимальные требования к организатору: на один ковёр — ноутбук и телевизор (плюс устойчивый Wi-Fi на площадке);
 * на одну возрастную категорию на одном ковре — руководитель ковра, арбитр, боковой судья и секундометрист.
 */
export interface HostingRequirements {
  laptops: number;
  tvs: number;
  wifi: true;
  matHeads: number;
  arbiters: number;
  sideJudges: number;
  timekeepers: number;
}

export function hostingRequirements(mats: number, ageGroups: number): HostingRequirements {
  const m = Math.max(0, Math.floor(mats) || 0);
  const crews = m * Math.max(1, Math.floor(ageGroups) || 0);
  return {
    laptops: m,
    tvs: m,
    wifi: true,
    matHeads: crews,
    arbiters: crews,
    sideJudges: crews,
    timekeepers: crews,
  };
}

const FullName = z.string().trim().min(3, { error: 'too_short' }).max(200, { error: 'too_long' });

/**
 * Ответственный за проведение (для связи с администратором платформы): сам автор заявки, другой
 * зарегистрированный пользователь (по email) или контактные данные — ФИО и телефон или почта.
 */
export const HostingResponsibleInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SELF') }),
  z.object({ kind: z.literal('USER'), email: Email }),
  z
    .object({
      kind: z.literal('CONTACT'),
      fullName: FullName,
      phone: E164.optional(),
      email: Email.optional(),
    })
    .refine((v) => v.phone !== undefined || v.email !== undefined, {
      error: 'contact_required',
      path: ['phone'],
    }),
]);
export type HostingResponsibleInput = z.infer<typeof HostingResponsibleInput>;

/** Ответственный в сохранённой заявке: пользователь (сам автор или выбранный) или контактные данные. */
export const HostingResponsible = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['SELF', 'USER']),
    userId: Uuid,
    displayName: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
  z.object({
    kind: z.literal('CONTACT'),
    fullName: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
  }),
]);
export type HostingResponsible = z.infer<typeof HostingResponsible>;

/** Поля заявки по описанию процесса (02.11.2026); сроки регистрации и взвешивания уточняет платформа позже. */
const HostingFields = {
  /** Полный адрес места проведения. */
  address: z.string().trim().min(5, { error: 'too_short' }).max(500, { error: 'too_long' }),
  /** Шаблонные возрастные группы платформы — одна или две (пусто, только пока шаблонов нет; проверяет сервис). */
  ageGroupIds: z
    .array(Uuid)
    .max(HOSTING_MAX_AGE_GROUPS, { error: 'too_many' })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate' }),
  matCount: z.number().int().min(1, { error: 'required' }).max(HOSTING_MAX_MATS, { error: 'too_many' }),
  equipment: z.enum(HOSTING_AVAILABILITY),
  refereeTeam: z.enum(HOSTING_AVAILABILITY),
  gender: z.enum(HOSTING_GENDERS),
};

/**
 * Предложение организации в сохранённой заявке. Заявки до 02.11.2026 содержали сроки регистрации, уровень и
 * площадку организации; новые — дату, адрес, возрастные группы, ковры, базу, бригаду, пол и ответственного.
 */
export const CompetitionRequestProposal = z.object({
  name: CompetitionFields.name,
  shortName: CompetitionFields.shortName,
  venueId: CompetitionFields.venueId,
  timezone: CompetitionFields.timezone,
  startDate: CompetitionFields.startDate,
  endDate: CompetitionFields.endDate,
  registrationStartsAt: CompetitionFields.registrationStartsAt.optional(),
  registrationEndsAt: CompetitionFields.registrationEndsAt.optional(),
  level: CompetitionFields.level,
  disciplineCode: CompetitionFields.disciplineCode,
  descriptionMd: CompetitionFields.descriptionMd,
  contactInfo: CompetitionFields.contactInfo,
  /** Открытый набор судей (правки 27.10.2026): создаётся вместе с турниром при одобрении заявки. */
  refereeRecruitment: RefereeRecruitmentInput.optional(),
  address: z.string().optional(),
  ageGroupIds: z.array(Uuid).optional(),
  matCount: z.number().int().optional(),
  equipment: z.enum(HOSTING_AVAILABILITY).optional(),
  refereeTeam: z.enum(HOSTING_AVAILABILITY).optional(),
  gender: z.enum(HOSTING_GENDERS).optional(),
  responsible: HostingResponsible.optional(),
  /** Когда автор согласился с правилами подачи заявки. */
  rulesAcceptedAt: z.string().optional(),
});
export type CompetitionRequestProposal = z.infer<typeof CompetitionRequestProposal>;

/**
 * Подача заявки (описание процесса, 02.11.2026): название, день проведения, адрес, до двух возрастных групп, число
 * ковров, наличие базы и судейской бригады, пол участников, ответственный и согласие с правилами подачи.
 */
export const CompetitionRequestCreate = z
  .object({
    organizationId: Uuid,
    name: CompetitionFields.name,
    /** День проведения; окончание — тот же день, если не указано. */
    startDate: CompetitionFields.startDate,
    endDate: CompetitionFields.endDate.optional(),
    ...HostingFields,
    responsible: HostingResponsibleInput,
    rulesAccepted: z.literal(true, { error: 'consent_required' }),
    /** Пояснение для администратора платформы. */
    comment: z.string().trim().max(2000, { error: 'too_long' }).optional(),
  })
  .superRefine((v, ctx) => {
    for (const i of scheduleIssues({ startDate: v.startDate, endDate: v.endDate ?? v.startDate }))
      ctx.addIssue({ code: 'custom', path: [i.path], message: i.code });
  });
export type CompetitionRequestCreate = z.infer<typeof CompetitionRequestCreate>;

export const CompetitionRequestReject = z.object({ reason: Reason });
export type CompetitionRequestReject = z.infer<typeof CompetitionRequestReject>;

export const CompetitionRequestsQuery = PageQuery.extend({
  status: z.enum(COMPETITION_REQUEST_STATUSES).optional(),
  organizationId: Uuid.optional(),
});
export type CompetitionRequestsQuery = z.infer<typeof CompetitionRequestsQuery>;

export type CompetitionRequestAction = 'approve' | 'reject' | 'withdraw';

export interface CompetitionRequestDto {
  id: string;
  status: CompetitionRequestStatus;
  organization: OrganizationRef;
  submittedBy: { id: string; displayName: string } | null;
  name: string;
  startDate: string;
  endDate: string;
  level: CompetitionLevel;
  venue: VenueRef | null;
  /** Выбранные возрастные группы (названия на момент чтения). */
  ageGroups: { id: string; name: LocalizedText; ageFrom: number; ageTo: number }[];
  /** Минимальные требования к базе и бригаде по числу ковров и возрастных групп; null у старых заявок. */
  requirements: HostingRequirements | null;
  proposal: CompetitionRequestProposal;
  expectedParticipants: number | null;
  comment: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  /** Турнир, созданный при одобрении. */
  competitionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  allowedActions: CompetitionRequestAction[];
}
