// Открытый набор судей на турнир (правки 27.10.2026): организатор объявляет должности персонала с требованиями к
// кандидатам (при создании турнира или позже, на его странице), судьи видят открытые наборы в разделе «Судейство» и
// подают заявку на должность, организатор одобряет заявку (судья получает эту роль в персонале турнира) или
// отклоняет её.
import { z } from 'zod';
import type { LocalizedText } from './common.js';
import type { CompetitionStatus, VenueRef } from './competitions.js';
import type { OrganizationRef } from './organizations.js';
import {
  type RefereeApplicationStatus,
  type RefereeRecruitmentStatus,
  REFEREE_RECRUITMENT_STATUSES,
} from './referee-recruitment-input.js';
import type { RoleCode } from './roles.js';

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
