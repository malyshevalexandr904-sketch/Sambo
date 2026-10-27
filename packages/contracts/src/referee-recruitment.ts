// Открытый набор судей на турнир (правки 27.10.2026): организатор объявляет должности персонала с требованиями к
// кандидатам (при создании турнира или позже, на его странице), судьи видят открытые наборы в разделе «Судейство» и
// подают заявку на должность, организатор одобряет заявку (судья получает эту роль в персонале турнира) или
// отклоняет её.
import { z } from 'zod';
import { CABINET_ROLE_GRANTS } from './cabinet-roles.js';
import type { LocalizedText } from './common.js';
import type { CompetitionStatus, VenueRef } from './competitions.js';
import type { OrganizationRef } from './organizations.js';
import type { RoleCode } from './roles.js';

/** Должности набора — роли персонала турнира, которые действуют в роли кабинета «Судья». */
export const RECRUITMENT_ROLE_CODES: readonly RoleCode[] = CABINET_ROLE_GRANTS.REFEREE;

export const REFEREE_RECRUITMENT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type RefereeRecruitmentStatus = (typeof REFEREE_RECRUITMENT_STATUSES)[number];

export const REFEREE_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RefereeApplicationStatus = (typeof REFEREE_APPLICATION_STATUSES)[number];

export const RECRUITMENT_REQUIREMENTS_MAX = 2000;

/** Должность в наборе: роль и требования организатора к кандидатам на неё. */
export const RefereeRecruitmentPositionInput = z.object({
  roleCode: z.enum(RECRUITMENT_ROLE_CODES as [RoleCode, ...RoleCode[]]),
  requirements: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .max(RECRUITMENT_REQUIREMENTS_MAX, { error: 'too_long' }),
});
export type RefereeRecruitmentPositionInput = z.infer<typeof RefereeRecruitmentPositionInput>;

/** Набор при создании турнира: список должностей (пустой или не указан — набора нет). */
export const RefereeRecruitmentInput = z
  .array(RefereeRecruitmentPositionInput)
  .max(20, { error: 'too_many' });

/** Закрыть набор на должность или открыть его снова. */
export const RefereeRecruitmentPositionPatch = z.object({ status: z.enum(REFEREE_RECRUITMENT_STATUSES) });
export type RefereeRecruitmentPositionPatch = z.infer<typeof RefereeRecruitmentPositionPatch>;

/** Решение организатора по заявке судьи. */
export const RefereeApplicationDecision = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });
export type RefereeApplicationDecision = z.infer<typeof RefereeApplicationDecision>;

/** Заявка судьи — для организатора: кто подал и его судейская категория. */
export interface RefereeApplicationDto {
  id: string;
  positionId: string;
  status: RefereeApplicationStatus;
  applicant: { id: string; displayName: string; email: string | null };
  refereeCategory: { code: string; name: LocalizedText } | null;
  createdAt: string;
  decidedAt: string | null;
  version: number;
}

/** Должность набора на странице турнира (организатор): с поступившими заявками. */
export interface RefereeRecruitmentPositionDto {
  id: string;
  competitionId: string;
  roleCode: RoleCode;
  requirements: string;
  status: RefereeRecruitmentStatus;
  version: number;
  createdAt: string;
  applications: RefereeApplicationDto[];
}

/** Открытый набор турнира — для судьи: турнир, должности, требования и его заявка на каждую. */
export interface OpenRefereeRecruitmentDto {
  competition: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: CompetitionStatus;
    organizer: OrganizationRef;
    venue: VenueRef | null;
  };
  positions: Array<{
    id: string;
    roleCode: RoleCode;
    requirements: string;
    myApplication: { id: string; status: RefereeApplicationStatus } | null;
  }>;
}
