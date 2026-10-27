// Заявки организаций на проведение турнира (docs/RATED_ONLY.md, 2): турнир создаёт только платформа, организация
// подаёт заявку с предлагаемыми сроками и местом. Одобрение создаёт черновик рейтингового турнира по заявке.
import { z } from 'zod';
import { PageQuery, Reason, Uuid } from './common.js';
import { type CompetitionLevel, CompetitionFields, scheduleIssues, type VenueRef } from './competitions.js';
import type { OrganizationRef } from './organizations.js';
import { RefereeRecruitmentInput } from './referee-recruitment.js';

export const COMPETITION_REQUEST_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type CompetitionRequestStatus = (typeof COMPETITION_REQUEST_STATUSES)[number];

/** Предложение организации: те же поля, что у турнира, кроме правил соревнований и логотипа — их задаёт платформа. */
const ProposalFields = {
  name: CompetitionFields.name,
  shortName: CompetitionFields.shortName,
  venueId: CompetitionFields.venueId,
  timezone: CompetitionFields.timezone,
  startDate: CompetitionFields.startDate,
  endDate: CompetitionFields.endDate,
  registrationStartsAt: CompetitionFields.registrationStartsAt,
  registrationEndsAt: CompetitionFields.registrationEndsAt,
  level: CompetitionFields.level,
  disciplineCode: CompetitionFields.disciplineCode,
  descriptionMd: CompetitionFields.descriptionMd,
  contactInfo: CompetitionFields.contactInfo,
  /** Открытый набор судей (правки 27.10.2026): создаётся вместе с турниром при одобрении заявки. */
  refereeRecruitment: RefereeRecruitmentInput.optional(),
};

export const CompetitionRequestProposal = z.object(ProposalFields);
export type CompetitionRequestProposal = z.infer<typeof CompetitionRequestProposal>;

export const CompetitionRequestCreate = z
  .object({
    ...ProposalFields,
    organizationId: Uuid,
    /** Ожидаемое число участников — для планирования ковров и судей. */
    expectedParticipants: z.number().int().min(1).max(5000).optional(),
    /** Пояснение для администратора платформы. */
    comment: z.string().trim().max(2000, { error: 'too_long' }).optional(),
  })
  .superRefine((v, ctx) => {
    for (const i of scheduleIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.code });
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
