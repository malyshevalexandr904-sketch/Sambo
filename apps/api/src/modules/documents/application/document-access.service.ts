// Доступ к документам (PERMISSIONS.md, 5; API.md, 4.6): просмотр — `document.view` в организации спортсмена
// (тренеру — по COACH_OWN), персоналу турнира — в контексте турнира, представителю и самому спортсмену —
// по связи; проверка — `document.verify`, турнирное право: в контексте турнира документа или у платформы.
import { Injectable } from '@nestjs/common';
import { ROLE_PERMISSIONS } from '@sde/contracts';
import type { Document, Prisma } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { CompetitionScopeService } from '../../competitions';
import { CoachesService } from '../../coaches';
import { OrganizationScopeService } from '../../organizations';

const todayDate = (): Date => new Date(new Date().toISOString().slice(0, 10));
const current = () => ({ OR: [{ validTo: null }, { validTo: { gte: todayDate() } }] });

type DocRef = Pick<Document, 'athleteId' | 'organizationId' | 'competitionId'>;

@Injectable()
export class DocumentAccessService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly athletes: AthleteAccessService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly competitions: CompetitionScopeService,
    private readonly coaches: CoachesService,
  ) {}

  private async competitionScope(competitionId: string | null): Promise<ResourceScope[]> {
    if (!competitionId || !(await this.competitions.exists(competitionId))) return [];
    return [await this.competitions.scopeOf(competitionId)];
  }

  /** Области просмотра: организации владельца и турнир, в контексте которого загружен документ. */
  async viewScopes(doc: DocRef): Promise<ResourceScope[]> {
    const owner = doc.athleteId
      ? await this.athletes.scopesOf(doc.athleteId)
      : doc.organizationId
        ? [{ ...(await this.orgScopes.scopeOf(doc.organizationId)), visibleToAll: false }]
        : [];
    return [...owner, ...(await this.competitionScope(doc.competitionId))];
  }

  /** Область проверки — турнир документа; без турнира — только платформа. */
  verifyScopes(doc: DocRef): Promise<ResourceScope[]> {
    return this.competitionScope(doc.competitionId);
  }

  /** Сам спортсмен или подтверждённый законный представитель. */
  async isRelated(user: AuthUser, athleteId: string | null): Promise<boolean> {
    if (!athleteId) return false;
    const r = await this.athletes.relation(user, athleteId);
    return r.relation === 'SELF' || (r.relation === 'GUARDIAN' && r.verified);
  }

  async canView(user: AuthUser, doc: DocRef): Promise<boolean> {
    if (await this.isRelated(user, doc.athleteId)) return true;
    const scopes = await this.viewScopes(doc);
    return this.policy.canAny(
      user,
      'document.view',
      scopes,
      doc.athleteId ? { athleteId: doc.athleteId } : {},
    );
  }

  async canVerify(user: AuthUser, doc: DocRef): Promise<boolean> {
    return this.policy.canAny(user, 'document.verify', await this.verifyScopes(doc));
  }

  /** Виден ли владелец документа (иначе 404 вместо 403). */
  async ownerVisible(user: AuthUser, doc: DocRef): Promise<boolean> {
    return this.policy.isVisibleAny(user, await this.viewScopes(doc));
  }

  /** Условие видимости списка в SQL тем же набором областей, что и права (PERMISSIONS.md, 6). */
  async visibilityFilter(user: AuthUser): Promise<Prisma.DocumentWhereInput | 'all'> {
    const reach = await this.policy.reach(user, 'document.view');
    if (reach.platform) return 'all';
    const or: Prisma.DocumentWhereInput[] = [];
    const direct = reach.organizations.filter((o) => o.mode === 'DIRECT').map((o) => o.organizationId);
    if (direct.length > 0) {
      or.push({ athlete: { memberships: { some: { organizationId: { in: direct }, ...current() } } } });
      or.push({ organizationId: { in: direct } });
    }
    const policyOrgs = reach.organizations.filter((o) => o.mode === 'POLICY').map((o) => o.organizationId);
    const coachId = policyOrgs.length > 0 ? await this.coaches.coachIdOfUser(user) : null;
    if (coachId) {
      or.push({
        athlete: {
          memberships: { some: { organizationId: { in: policyOrgs }, ...current() } },
          coaches: { some: { coachId, ...current() } },
        },
      });
    }
    const grants = await this.policy.grants(user);
    const competitions = grants.competitions
      .filter((g) => g.roles.some((r) => ROLE_PERMISSIONS[r]['document.view'] !== undefined))
      .map((g) => g.competitionId);
    if (competitions.length > 0) or.push({ competitionId: { in: competitions } });
    if (user.personId) {
      or.push({ athlete: { personId: user.personId } });
      or.push({
        athlete: {
          guardians: { some: { guardianPersonId: user.personId, endedAt: null, verifiedAt: { not: null } } },
        },
      });
    }
    return or.length > 0 ? { OR: or } : { id: { in: [] } };
  }
}
