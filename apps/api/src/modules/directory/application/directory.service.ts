// Участники платформы (правки 07.11.2026, п. 7, 8, 10): поиск по ФИО и страница участника — то, что он видит в своём
// личном кабинете: фото, ФИО, роли, возраст, город, организации; у спортсмена — Elo, медали и выступления; у тренера и
// руководителя — команда; у судьи — категория, стаж, отсуженные турниры и рейтинг по оценкам организаторов.
// Только для вошедших пользователей; контакты и дата рождения не показываются.
import { Injectable } from '@nestjs/common';
import {
  averageStars,
  CABINET_ROLE_GRANTS,
  experienceYears,
  fullYearsOn,
  type PublicProfileRole,
  type RefereeStatsDto,
  type UserProfileDto,
  type UserSearchItem,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DivisionsService } from '../../divisions';
import { FilesService } from '../../files';
import { RatingRankingsService } from '../../rating';
import { ResultsQueriesService } from '../../results';

const SEARCH_LIMIT = 20;
/** Событий Elo на странице — как в кабинете спортсмена. */
const PROGRESS_EVENTS = 500;
const HEAD_ROLES = [...CABINET_ROLE_GRANTS.ORGANIZATION_HEAD];
const REFEREE_ROLES = [...CABINET_ROLE_GRANTS.REFEREE];
const FINISHED = ['FINISHED', 'ARCHIVED'] as const;

const today = (): string => new Date().toISOString().slice(0, 10);
const todayDate = (): Date => new Date(today());

/** Действующий пользователь, которого можно найти: не демо, не удалён, не заблокирован. */
const LISTED: Prisma.UserWhereInput = { deletedAt: null, isDemo: false, status: 'ACTIVE' };

const PERSON_SELECT = {
  id: true,
  birthDate: true,
  city: true,
  photo: { select: { status: true, bucket: true, storageKey: true } },
  athleteProfile: { select: { id: true, status: true } },
  coachProfile: { select: { id: true, status: true } },
  refereeProfile: {
    select: {
      status: true,
      refereeCategoryCode: true,
      refereeSinceYear: true,
      category: { select: { nameRu: true, nameEn: true } },
    },
  },
} satisfies Prisma.PersonSelect;

const USER_SELECT = {
  id: true,
  displayName: true,
  person: { select: PERSON_SELECT },
  organizationMemberships: {
    where: { status: 'ACTIVE', role: { code: { in: HEAD_ROLES } } },
    select: { organizationId: true, validTo: true, organization: { select: { id: true, name: true } } },
  },
  competitionMemberships: {
    where: { status: 'ACTIVE', role: { code: { in: REFEREE_ROLES } } },
    select: { competitionId: true },
    take: 1,
  },
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class DirectoryService {
  constructor(
    private readonly db: PrismaService,
    private readonly files: FilesService,
    private readonly rankings: RatingRankingsService,
    private readonly divisions: DivisionsService,
    private readonly results: ResultsQueriesService,
  ) {}

  /** Поиск по ФИО: каждое слово запроса — в фамилии, имени или отчестве (ё = е не различается — как в «человеке»). */
  async search(q: string): Promise<UserSearchItem[]> {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const rows = await this.db.user.findMany({
      where: {
        ...LISTED,
        AND: words.map((w) => ({
          OR: [
            { displayName: { contains: w, mode: 'insensitive' as const } },
            { person: { lastName: { contains: w, mode: 'insensitive' as const } } },
            { person: { firstName: { contains: w, mode: 'insensitive' as const } } },
            { person: { middleName: { contains: w, mode: 'insensitive' as const } } },
          ],
        })),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: SEARCH_LIMIT,
      select: USER_SELECT,
    });
    return rows.map((u) => ({
      userId: u.id,
      name: u.displayName,
      avatarUrl: this.avatar(u),
      roles: this.roles(u),
      city: u.person?.city ?? null,
    }));
  }

  async profile(viewer: AuthUser, userId: string): Promise<UserProfileDto> {
    const u = await this.db.user.findFirst({
      where: { id: userId, ...(viewer.id === userId ? { deletedAt: null } : LISTED) },
      select: USER_SELECT,
    });
    if (!u) throw new DomainError('NOT_FOUND', { resource: 'user' });
    const person = u.person;
    const roles = this.roles(u);
    const [athlete, coach, head, referee, organizations] = await Promise.all([
      roles.includes('ATHLETE') && person?.athleteProfile ? this.athlete(person.athleteProfile.id) : null,
      roles.includes('COACH') && person?.coachProfile ? this.coach(person.coachProfile.id) : null,
      roles.includes('ORGANIZATION_HEAD') ? this.head(this.headOrgIds(u)) : null,
      roles.includes('REFEREE') ? this.referee(u) : null,
      this.organizations(u),
    ]);
    return {
      userId: u.id,
      name: u.displayName,
      avatarUrl: this.avatar(u),
      roles,
      age: person ? fullYearsOn(person.birthDate.toISOString().slice(0, 10), today()) : null,
      city: person?.city ?? null,
      organizations,
      athlete,
      coach,
      head,
      referee,
      self: viewer.id === userId,
    };
  }

  /** Статистика судьи для своей страницы и для страницы участника. */
  async refereeStats(userId: string): Promise<RefereeStatsDto> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    return this.referee(u);
  }

  // ---------- Внутреннее ----------

  private avatar(u: UserRow): string | null {
    const photo = u.person?.photo;
    return photo && photo.status === 'AVAILABLE' && photo.bucket === 'PUBLIC_MEDIA'
      ? this.files.publicUrl(photo.storageKey)
      : null;
  }

  private headOrgIds(u: UserRow): string[] {
    const now = todayDate();
    return [
      ...new Set(
        u.organizationMemberships.filter((m) => !m.validTo || m.validTo >= now).map((m) => m.organizationId),
      ),
    ];
  }

  private roles(u: UserRow): PublicProfileRole[] {
    const p = u.person;
    const held = new Set<PublicProfileRole>();
    if (this.headOrgIds(u).length > 0) held.add('ORGANIZATION_HEAD');
    if (p?.coachProfile?.status === 'ACTIVE') held.add('COACH');
    if (p?.refereeProfile?.status === 'ACTIVE' || u.competitionMemberships.length > 0) held.add('REFEREE');
    if (p?.athleteProfile?.status === 'ACTIVE') held.add('ATHLETE');
    return (['ORGANIZATION_HEAD', 'COACH', 'REFEREE', 'ATHLETE'] as const).filter((r) => held.has(r));
  }

  private async organizations(u: UserRow): Promise<{ id: string; name: string }[]> {
    const now = todayDate();
    const map = new Map<string, string>();
    for (const m of u.organizationMemberships)
      if (!m.validTo || m.validTo >= now) map.set(m.organization.id, m.organization.name);
    const p = u.person;
    if (p?.coachProfile) {
      const rows = await this.db.coachMembership.findMany({
        where: { coachId: p.coachProfile.id, validTo: null },
        select: { organization: { select: { id: true, name: true } } },
      });
      for (const r of rows) map.set(r.organization.id, r.organization.name);
    }
    if (p?.athleteProfile) {
      const rows = await this.db.athleteMembership.findMany({
        where: { athleteId: p.athleteProfile.id, OR: [{ validTo: null }, { validTo: { gte: now } }] },
        orderBy: { isPrimary: 'desc' },
        select: { organization: { select: { id: true, name: true } } },
      });
      for (const r of rows) map.set(r.organization.id, r.organization.name);
    }
    return [...map].map(([id, name]) => ({ id, name }));
  }

  private async athlete(athleteId: string): Promise<NonNullable<UserProfileDto['athlete']>> {
    const now = todayDate();
    const row = await this.db.athleteProfile.findUniqueOrThrow({
      where: { id: athleteId },
      select: {
        person: { select: { birthDate: true } },
        memberships: {
          where: { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: { organization: { select: { name: true } } },
        },
        coaches: {
          where: { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: {
            coach: { select: { person: { select: { lastName: true, firstName: true, middleName: true } } } },
          },
        },
        ranks: {
          where: { revokedAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: { sportRankCode: true },
        },
      },
    });
    const [division, progress, history] = await Promise.all([
      this.divisions.forBirthDate(row.person.birthDate.toISOString().slice(0, 10)),
      this.rankings.progress(athleteId, PROGRESS_EVENTS),
      this.results.historyOf(athleteId),
    ]);
    const c = row.coaches[0]?.coach.person;
    return {
      athleteId,
      club: row.memberships[0]?.organization.name ?? null,
      coach: c ? [c.lastName, c.firstName, c.middleName].filter(Boolean).join(' ') : null,
      rankCode: row.ranks[0]?.sportRankCode ?? null,
      progress: { ...progress, division },
      history,
    };
  }

  private async coach(coachId: string): Promise<{ athletes: number }> {
    const athletes = await this.db.athleteCoach.count({
      where: { coachId, OR: [{ validTo: null }, { validTo: { gte: todayDate() } }] },
    });
    return { athletes };
  }

  private async head(organizationIds: string[]): Promise<{ coaches: number; athletes: number }> {
    if (organizationIds.length === 0) return { coaches: 0, athletes: 0 };
    const now = todayDate();
    const [coaches, athletes] = await Promise.all([
      this.db.coachMembership.findMany({
        where: { organizationId: { in: organizationIds }, validTo: null, coach: { status: 'ACTIVE' } },
        select: { coachId: true },
        distinct: ['coachId'],
      }),
      this.db.athleteMembership.findMany({
        where: {
          organizationId: { in: organizationIds },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
          athlete: { status: 'ACTIVE' },
        },
        select: { athleteId: true },
        distinct: ['athleteId'],
      }),
    ]);
    return { coaches: coaches.length, athletes: athletes.length };
  }

  private async referee(u: UserRow): Promise<RefereeStatsDto> {
    const profile = u.person?.refereeProfile ?? null;
    const [judged, ratings] = await Promise.all([
      this.db.competitionMembership.findMany({
        where: {
          userId: u.id,
          status: 'ACTIVE',
          role: { code: { in: REFEREE_ROLES } },
          competition: { deletedAt: null, status: { in: [...FINISHED] } },
        },
        select: { competitionId: true },
        distinct: ['competitionId'],
      }),
      this.db.refereeRating.findMany({
        where: { refereeUserId: u.id, competition: { deletedAt: null } },
        select: { stars: true },
      }),
    ]);
    const sinceYear = profile?.refereeSinceYear ?? null;
    return {
      categoryCode: profile?.refereeCategoryCode ?? null,
      categoryName: profile ? { ru: profile.category.nameRu, en: profile.category.nameEn } : null,
      sinceYear,
      experienceYears: experienceYears(sinceYear, today()),
      tournaments: judged.length,
      rating: { average: averageStars(ratings.map((r) => r.stars)), count: ratings.length },
    };
  }
}
