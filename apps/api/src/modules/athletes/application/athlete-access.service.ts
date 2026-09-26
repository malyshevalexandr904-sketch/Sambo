// Доступ к спортсмену (PERMISSIONS.md, 5): области — организации текущих членств (CLUB_MEMBER, ORG_DESCENDANT),
// политики отношений COACH_OWN (◐ у тренера), SELF и GUARDIAN (подтверждённый представитель).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type AthleteRelation, fullName, type PermissionCode } from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { CoachesService } from '../../coaches';
import { OrganizationScopeService } from '../../organizations';

const todayDate = (): Date => new Date(new Date().toISOString().slice(0, 10));

/** Условие «период действует сегодня» для членств и связей с тренером. */
export const currentPeriod = (): { OR: [{ validTo: null }, { validTo: { gte: Date } }] } => ({
  OR: [{ validTo: null }, { validTo: { gte: todayDate() } }],
});

/** Права, для которых у тренера действует политика COACH_OWN (◐ в матрице). */
const COACH_OWN_PERMISSIONS: readonly PermissionCode[] = [
  'athlete.update',
  'guardian.manage',
  'consent.record',
  'document.view',
];

export interface RelationInfo {
  relation: AthleteRelation | null;
  /** Для представителя — подтверждён ли тренером или клубом. */
  verified: boolean;
  guardianId: string | null;
}

export interface AthleteBasics {
  athleteId: string;
  personId: string;
  birthDate: string;
}

/** Сведения спортсмена для заявки на турнир: снимок участия (ADR-10) и проверка принадлежности клубу. */
export interface AthleteRegistrationInfo {
  athleteId: string;
  personId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: 'MALE' | 'FEMALE';
  personRegionId: string | null;
  /** Текущие членства: основной клуб — первым. */
  memberships: {
    organizationId: string;
    name: string;
    shortName: string;
    regionId: string | null;
    isPrimary: boolean;
  }[];
  coachName: string | null;
  rankCode: string | null;
}

export interface AthleteResourceRef {
  athleteId: string;
}

@Injectable()
export class AthleteAccessService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly registry: ScopeResolverRegistry,
    private readonly orgScopes: OrganizationScopeService,
    private readonly coaches: CoachesService,
  ) {}

  onModuleInit(): void {
    this.registry.register('athlete', async (id) => ({
      scopes: await this.scopesOf(id),
      resource: { athleteId: id } satisfies Partial<AthleteResourceRef>,
    }));
    for (const permission of COACH_OWN_PERMISSIONS) {
      this.policy.registerPolicy(permission, (user, _scope, resource) => this.coachOwn(user, resource));
    }
  }

  /** Области спортсмена — организации текущих членств, видимые только участникам. Нет спортсмена — 404. */
  async scopesOf(athleteId: string | undefined): Promise<ResourceScope[]> {
    if (!athleteId) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    const athlete = await this.db.athleteProfile.findUnique({
      where: { id: athleteId },
      select: { memberships: { where: currentPeriod(), select: { organizationId: true } } },
    });
    if (!athlete) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    const orgIds = [...new Set(athlete.memberships.map((m) => m.organizationId))];
    // Спортсмен не публичен оттого, что публичен клуб: без прав — 404 (PERMISSIONS.md, 7).
    const scopes = await Promise.all(orgIds.map((id) => this.orgScopes.scopeOf(id)));
    return scopes.map((s) => ({ ...s, visibleToAll: false }));
  }

  /** COACH_OWN: у пользователя есть профиль тренера с действующей связью с этим спортсменом. */
  async coachOwn(user: AuthUser, resource: unknown): Promise<boolean> {
    const athleteId = (resource as Partial<AthleteResourceRef> | undefined)?.athleteId;
    if (!athleteId) return false;
    const coachId = await this.coaches.coachIdOfUser(user);
    if (!coachId) return false;
    const link = await this.db.athleteCoach.findFirst({
      where: { athleteId, coachId, ...currentPeriod() },
      select: { id: true },
    });
    return link !== null;
  }

  /** SELF — это сам спортсмен; GUARDIAN — действующий законный представитель. */
  async relation(user: AuthUser, athleteId: string): Promise<RelationInfo> {
    if (!user.personId) return { relation: null, verified: false, guardianId: null };
    const athlete = await this.db.athleteProfile.findUnique({
      where: { id: athleteId },
      select: { personId: true },
    });
    if (!athlete) return { relation: null, verified: false, guardianId: null };
    if (athlete.personId === user.personId) return { relation: 'SELF', verified: true, guardianId: null };
    const guardian = await this.db.guardian.findFirst({
      where: { athleteId, guardianPersonId: user.personId, endedAt: null },
      select: { id: true, verifiedAt: true },
    });
    return guardian
      ? { relation: 'GUARDIAN', verified: guardian.verifiedAt !== null, guardianId: guardian.id }
      : { relation: null, verified: false, guardianId: null };
  }

  /** Основные сведения спортсмена для соседних модулей (согласия, документы). */
  async basics(where: { athleteId: string } | { personId: string }): Promise<AthleteBasics | null> {
    const row = await this.db.athleteProfile.findUnique({
      where: 'athleteId' in where ? { id: where.athleteId } : { personId: where.personId },
      select: { id: true, personId: true, person: { select: { birthDate: true } } },
    });
    return row
      ? {
          athleteId: row.id,
          personId: row.personId,
          birthDate: row.person.birthDate.toISOString().slice(0, 10),
        }
      : null;
  }

  async registrationInfo(athleteId: string, tx?: Tx): Promise<AthleteRegistrationInfo | null> {
    const a = await (tx ?? this.db).athleteProfile.findUnique({
      where: { id: athleteId },
      include: {
        person: true,
        memberships: {
          where: currentPeriod(),
          orderBy: [{ isPrimary: 'desc' }, { validFrom: 'desc' }],
          include: { organization: { select: { id: true, name: true, shortName: true, regionId: true } } },
        },
        coaches: {
          where: currentPeriod(),
          orderBy: [{ isPrimary: 'desc' }, { validFrom: 'desc' }],
          include: { coach: { include: { person: true } } },
        },
        ranks: {
          where: { revokedAt: null },
          orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    });
    if (!a) return null;
    const coach = a.coaches[0]?.coach.person ?? null;
    return {
      athleteId: a.id,
      personId: a.personId,
      status: a.status,
      lastName: a.person.lastName,
      firstName: a.person.firstName,
      middleName: a.person.middleName,
      birthDate: a.person.birthDate.toISOString().slice(0, 10),
      gender: a.person.gender,
      personRegionId: a.person.regionId,
      memberships: a.memberships.map((m) => ({
        organizationId: m.organization.id,
        name: m.organization.name,
        shortName: m.organization.shortName,
        regionId: m.organization.regionId,
        isPrimary: m.isPrimary,
      })),
      coachName: coach ? fullName(coach) : null,
      rankCode: a.ranks[0]?.sportRankCode ?? null,
    };
  }

  /** Действующий представитель спортсмена. */
  async guardian(
    athleteId: string,
    guardianId: string,
  ): Promise<{ personId: string; verified: boolean } | null> {
    const g = await this.db.guardian.findFirst({ where: { id: guardianId, athleteId, endedAt: null } });
    return g ? { personId: g.guardianPersonId, verified: g.verifiedAt !== null } : null;
  }

  /** У пользователя есть спортсмены по связи: он сам или подтверждённый представитель. */
  async hasRelations(user: AuthUser): Promise<boolean> {
    if (!user.personId) return false;
    const [self, guardian] = await Promise.all([
      this.db.athleteProfile.findUnique({ where: { personId: user.personId }, select: { id: true } }),
      this.db.guardian.findFirst({
        where: { guardianPersonId: user.personId, endedAt: null, verifiedAt: { not: null } },
        select: { id: true },
      }),
    ]);
    return self !== null || guardian !== null;
  }

  /** Право на спортсмена в любой из его организаций (с политиками), иначе 403 / 404. */
  async assert(user: AuthUser, permission: PermissionCode, athleteId: string): Promise<ResourceScope[]> {
    const scopes = await this.scopesOf(athleteId);
    await this.policy.assertAny(user, permission, scopes, { athleteId } satisfies AthleteResourceRef);
    return scopes;
  }

  async can(user: AuthUser, permission: PermissionCode, athleteId: string): Promise<boolean> {
    const scopes = await this.scopesOf(athleteId);
    return this.policy.canAny(user, permission, scopes, { athleteId } satisfies AthleteResourceRef);
  }

  /**
   * Просмотр карточки: `athlete.view` в организации спортсмена, сам спортсмен (SELF)
   * или подтверждённый представитель (GUARDIAN). Иначе — 404: о чужом спортсмене не сообщается.
   */
  async assertView(
    user: AuthUser,
    athleteId: string,
  ): Promise<{ scopes: ResourceScope[]; relation: RelationInfo }> {
    const scopes = await this.scopesOf(athleteId);
    const relation = await this.relation(user, athleteId);
    if (relation.relation === 'SELF' || (relation.relation === 'GUARDIAN' && relation.verified))
      return { scopes, relation };
    if (await this.policy.canAny(user, 'athlete.view', scopes, { athleteId })) return { scopes, relation };
    throw new DomainError('NOT_FOUND', { resource: 'athlete' });
  }
}
