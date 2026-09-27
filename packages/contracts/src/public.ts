// Публичная витрина турнира (API.md, 5.9; ADR-15): белый список полей, без персональных данных.
import { z } from 'zod';
import { LocalDate, type LocalizedText, PageQuery, Uuid } from './common.js';
import type { CategoryAge, CategoryWeight } from './competition-categories.js';
import {
  type CategoryStatus,
  type CompetitionContactInfo,
  type CompetitionLevel,
  type CompetitionStatus,
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
  regulationUrl: string | null;
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
}
