// Выборки турниров: видимость черновиков по правам и фильтры списка (API.md, 5.1).
import { type CompetitionsQuery, ROLE_PERMISSIONS, ROLES, type RoleCode } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { decodeCursor } from '../../../common/http/http';
import type { EffectiveGrants } from '../../access';
import { toDate } from './competition-edit';

/**
 * Видимость черновиков: платформа, организации с правом просмотра турниров (организатор ▲, федерация — с
 * дочерними) и персонал турнира. Опубликованные турниры видит любой вошедший.
 */
export function staffFilter(grants: EffectiveGrants): Prisma.CompetitionWhereInput | 'all' {
  const canView = (roles: RoleCode[]): boolean =>
    roles.some((r) => ROLE_PERMISSIONS[r]['competition.view'] !== undefined);
  if (canView(grants.platform)) return 'all';
  const direct: string[] = [];
  const withDescendants: string[] = [];
  for (const g of grants.organizations) {
    if (g.organizationStatus !== 'ACTIVE') continue;
    for (const r of g.roles) {
      if (ROLE_PERMISSIONS[r]['competition.view'] === undefined) continue;
      (ROLES[r].inheritsToDescendants ? withDescendants : direct).push(g.organizationId);
    }
  }
  const or: Prisma.CompetitionWhereInput[] = [];
  if (direct.length > 0) or.push({ organizerOrganizationId: { in: direct } });
  if (withDescendants.length > 0)
    or.push({ organizer: { ancestors: { some: { ancestorId: { in: withDescendants } } } } });
  const staffOf = grants.competitions.filter((g) => canView(g.roles)).map((g) => g.competitionId);
  if (staffOf.length > 0) or.push({ id: { in: staffOf } });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/** Условия списка: «мои» — только служебные; иначе опубликованные и черновики с правом просмотра. */
export function listWhere(
  q: CompetitionsQuery,
  staff: Prisma.CompetitionWhereInput | 'all',
  now: Date,
): Prisma.CompetitionWhereInput[] {
  const and: Prisma.CompetitionWhereInput[] = [{ deletedAt: null }];
  if (q.mine) {
    if (staff !== 'all') and.push(staff);
  } else if (staff !== 'all') {
    and.push({ OR: [{ status: { not: 'DRAFT' } }, staff] });
  }
  if (q.status) and.push({ status: q.status });
  if (q.organizerId) and.push({ organizerOrganizationId: q.organizerId });
  if (q.from) and.push({ endDate: { gte: toDate(q.from) } });
  if (q.to) and.push({ startDate: { lte: toDate(q.to) } });
  if (q.q) and.push({ name: { contains: q.q, mode: 'insensitive' } });
  if (q.registrationOpen) {
    and.push({
      status: 'REGISTRATION_OPEN',
      registrationStartsAt: { lte: now },
      registrationEndsAt: { gt: now },
    });
  }
  const cursor = decodeCursor(q.cursor);
  if (cursor) {
    const at = toDate(cursor.k);
    and.push({ OR: [{ startDate: { lt: at } }, { startDate: at, id: { lt: cursor.id } }] });
  }
  return and;
}
