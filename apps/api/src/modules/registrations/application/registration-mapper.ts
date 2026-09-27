// Представления заявки и участия в ответах API.
import type { ApplicationSummary, EntryDto } from '@sde/contracts';
import type { Prisma } from '@sde/db';

export const ENTRY_INCLUDE = {
  category: { select: { id: true, code: true, nameRu: true, nameEn: true } },
  declaredCategory: { select: { id: true, code: true, nameRu: true, nameEn: true } },
  application: { select: { organization: { select: { id: true, name: true, shortName: true } } } },
  representationOrg: { select: { id: true, name: true, shortName: true } },
  representationRegion: { select: { id: true, nameRu: true, nameEn: true } },
} satisfies Prisma.EntryInclude;

export type EntryRow = Prisma.EntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export const APPLICATION_INCLUDE = {
  competition: {
    select: { id: true, slug: true, name: true, status: true, startDate: true, timezone: true },
  },
  organization: { select: { id: true, name: true, shortName: true } },
  coach: { select: { id: true, person: { select: { lastName: true, firstName: true, middleName: true } } } },
  representationOrg: { select: { id: true, name: true, shortName: true } },
  representationRegion: { select: { id: true, nameRu: true, nameEn: true } },
} satisfies Prisma.ApplicationInclude;

export type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

const cat = (c: { id: string; code: string; nameRu: string; nameEn: string }) => ({
  id: c.id,
  code: c.code,
  name: { ru: c.nameRu, en: c.nameEn },
});

export function toEntryDto(e: EntryRow, allowedActions: string[]): EntryDto {
  return {
    id: e.id,
    competitionId: e.competitionId,
    applicationId: e.applicationId,
    organization: e.application.organization,
    athleteId: e.athleteId,
    category: cat(e.category),
    declaredCategory: cat(e.declaredCategory),
    snapshot: {
      lastName: e.snapLastName,
      firstName: e.snapFirstName,
      middleName: e.snapMiddleName,
      birthDate: e.snapBirthDate.toISOString().slice(0, 10),
      gender: e.snapGender,
      club: { id: e.snapClubId, name: e.snapClubName },
      coachName: e.snapCoachName,
      region: { id: e.snapRegionId, name: e.snapRegionName },
      rankCode: e.snapRankCode,
    },
    representation: {
      organization: e.representationOrg,
      region: e.representationRegion
        ? {
            id: e.representationRegion.id,
            name: { ru: e.representationRegion.nameRu, en: e.representationRegion.nameEn },
          }
        : null,
    },
    publicName: e.publicName,
    status: e.status,
    declaredWeightGrams: e.declaredWeightGrams,
    decidedAt: e.decidedAt?.toISOString() ?? null,
    decisionReason: e.decisionReason,
    withdrawReason: e.withdrawReason,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    allowedActions,
  };
}

export interface EntryCounts {
  entries: number;
  pending: number;
  approved: number;
  rejected: number;
  withdrawn: number;
}

export const EMPTY_COUNTS: EntryCounts = { entries: 0, pending: 0, approved: 0, rejected: 0, withdrawn: 0 };

export function toApplicationSummary(
  a: ApplicationRow,
  counts: EntryCounts,
  allowedActions: string[],
): ApplicationSummary {
  return {
    id: a.id,
    competition: {
      id: a.competition.id,
      slug: a.competition.slug,
      name: a.competition.name,
      status: a.competition.status,
      startDate: a.competition.startDate.toISOString().slice(0, 10),
      timezone: a.competition.timezone,
    },
    organization: a.organization,
    coach: a.coach
      ? {
          id: a.coach.id,
          name: [a.coach.person.lastName, a.coach.person.firstName, a.coach.person.middleName]
            .filter(Boolean)
            .join(' '),
        }
      : null,
    status: a.status,
    counts,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    reviewComment: a.reviewComment,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    allowedActions,
  };
}
