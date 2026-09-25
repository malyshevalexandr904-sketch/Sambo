// Представления спортсмена для API: строки БД наружу не отдаются (ARCHITECTURE.md, 5).
import {
  type AthleteMembershipDto,
  type AthleteSummary,
  type CoachLinkDto,
  fullName,
  type GuardianSummary,
  type RankRecordDto,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { personDto } from '../../people';
import { dateOnly, isCurrent } from '../domain/athlete-rules';

const todayDate = (): Date => new Date(new Date().toISOString().slice(0, 10));
const current = () => ({ OR: [{ validTo: null }, { validTo: { gte: todayDate() } }] });

export const summaryInclude = () =>
  ({
    person: true,
    memberships: {
      where: current(),
      orderBy: [{ isPrimary: 'desc' }, { validFrom: 'desc' }],
      include: { organization: { select: { id: true, name: true, shortName: true } } },
    },
    coaches: {
      where: current(),
      orderBy: [{ isPrimary: 'desc' }, { validFrom: 'desc' }],
      include: { coach: { include: { person: true } } },
    },
    ranks: { where: { revokedAt: null }, orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }], take: 1 },
  }) satisfies Prisma.AthleteProfileInclude;

export type SummaryRow = Prisma.AthleteProfileGetPayload<{ include: ReturnType<typeof summaryInclude> }>;

export function toSummary(a: SummaryRow): AthleteSummary {
  const club = a.memberships[0]?.organization ?? null;
  const coach = a.coaches[0]?.coach ?? null;
  return {
    id: a.id,
    publicId: a.publicId,
    lastName: a.person.lastName,
    firstName: a.person.firstName,
    middleName: a.person.middleName,
    birthDate: dateOnly(a.person.birthDate),
    gender: a.person.gender,
    status: a.status,
    club,
    coach: coach ? { id: coach.id, name: fullName(coach.person) } : null,
    rankCode: a.ranks[0]?.sportRankCode ?? null,
    version: a.version,
  };
}

export const detailInclude = () =>
  ({
    person: true,
    memberships: {
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      include: { organization: { select: { id: true, name: true, shortName: true } } },
    },
    coaches: {
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      include: { coach: { include: { person: true } } },
    },
    ranks: {
      where: { revokedAt: null },
      orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      include: { sportRank: true },
    },
    guardians: {
      where: { endedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { guardianPerson: { include: { user: { select: { id: true } } } } },
    },
  }) satisfies Prisma.AthleteProfileInclude;

export type DetailRow = Prisma.AthleteProfileGetPayload<{ include: ReturnType<typeof detailInclude> }>;

export function membershipDto(m: DetailRow['memberships'][number], today: string): AthleteMembershipDto {
  const validTo = m.validTo ? dateOnly(m.validTo) : null;
  return {
    id: m.id,
    organization: m.organization,
    isPrimary: m.isPrimary,
    validFrom: dateOnly(m.validFrom),
    validTo,
    active: isCurrent(validTo, today),
  };
}

export function coachLinkDto(c: DetailRow['coaches'][number], today: string): CoachLinkDto {
  const validTo = c.validTo ? dateOnly(c.validTo) : null;
  return {
    id: c.id,
    coach: { id: c.coach.id, name: fullName(c.coach.person) },
    isPrimary: c.isPrimary,
    validFrom: dateOnly(c.validFrom),
    validTo,
    active: isCurrent(validTo, today),
  };
}

export function guardianDto(g: DetailRow['guardians'][number]): GuardianSummary {
  return {
    id: g.id,
    personId: g.guardianPersonId,
    lastName: g.guardianPerson.lastName,
    firstName: g.guardianPerson.firstName,
    middleName: g.guardianPerson.middleName,
    relation: g.relation,
    verifiedAt: g.verifiedAt?.toISOString() ?? null,
    verificationBasis: g.verificationBasis,
    hasAccount: g.guardianPerson.user !== null,
  };
}

export function rankDto(r: Prisma.AthleteRankRecordGetPayload<object>): RankRecordDto {
  return {
    id: r.id,
    sportRankCode: r.sportRankCode,
    assignedAt: dateOnly(r.assignedAt),
    orderRef: r.orderRef,
    documentId: r.documentId,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    revokeReason: r.revokeReason,
    createdAt: r.createdAt.toISOString(),
  };
}

export { personDto };
