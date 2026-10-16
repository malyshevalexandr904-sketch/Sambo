// Доступ к заявкам на регистрацию (Phase 9a; PERMISSIONS.md, 5): заявитель — к своей заявке; проверяющий платформы
// (`onboarding.review` на платформе) — к отправленным заявкам; руководитель организации (`onboarding.review` в
// организации, федерация — и в дочерних) — к заявкам в свою организацию; тренер — только к заявкам спортсменов,
// выбравших его, и только если руководитель дал ему это право. Черновик видит только заявитель.
import { Injectable } from '@nestjs/common';
import type { OnboardingStatus } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { CoachesService } from '../../coaches';
import { OrganizationScopeService } from '../../organizations';
import { type OnboardingActor, reviewerOf } from '../domain/onboarding-rules';

interface RequestRef {
  userId: string;
  status: OnboardingStatus;
  role: string;
  organizationId: string | null;
  coachId: string | null;
}

@Injectable()
export class OnboardingAccessService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly coaches: CoachesService,
  ) {}

  isApplicant(user: AuthUser, r: RequestRef): boolean {
    return r.userId === user.id;
  }

  async isPlatformReviewer(user: AuthUser): Promise<boolean> {
    return this.policy.can(user, 'onboarding.review', { kind: 'PLATFORM' });
  }

  /** Руководитель организации заявки (или вышестоящей федерации, или платформа). */
  async isOrganizationReviewer(user: AuthUser, organizationId: string): Promise<boolean> {
    const scope = await this.orgScopes.scopeOf(organizationId);
    return this.policy.can(user, 'onboarding.review', scope);
  }

  /** Тренер, выбранный спортсменом, с назначенным правом рассматривать заявки в этой организации. */
  async isCoachReviewer(user: AuthUser, r: RequestRef): Promise<boolean> {
    if (r.role !== 'ATHLETE' || !r.coachId || !r.organizationId) return false;
    const coachId = await this.coaches.coachIdOfUser(user);
    if (coachId !== r.coachId) return false;
    return this.coaches.canReviewAthletes(this.db, coachId, r.organizationId);
  }

  /** Может ли пользователь принять решение по заявке в её текущем статусе (и в роли кого). */
  async reviewerRole(user: AuthUser, r: RequestRef): Promise<Exclude<OnboardingActor, 'APPLICANT'> | null> {
    if (r.userId === user.id) return null; // свою заявку не проверяют
    const needed = reviewerOf(r.status);
    if (needed === 'PLATFORM') return (await this.isPlatformReviewer(user)) ? 'PLATFORM' : null;
    if (needed === 'ORGANIZATION' && r.organizationId) {
      if (await this.isOrganizationReviewer(user, r.organizationId)) return 'ORGANIZATION';
      if (await this.isCoachReviewer(user, r)) return 'ORGANIZATION';
    }
    return null;
  }

  /** Видит ли пользователь заявку как проверяющий (в том числе уже решённую — история). */
  async canViewAsReviewer(user: AuthUser, r: RequestRef): Promise<boolean> {
    if (r.status === 'DRAFT') return false;
    if (await this.isPlatformReviewer(user)) return true;
    if (!r.organizationId) return false;
    if (await this.isOrganizationReviewer(user, r.organizationId)) return true;
    return this.isCoachReviewer(user, r);
  }

  /**
   * Очередь проверки в SQL: платформа — все отправленные; организация — заявки в свои организации (федерация — и в
   * дочерние); тренер — заявки выбравших его спортсменов там, где у него есть право. Черновики — никому.
   */
  async reviewFilter(user: AuthUser): Promise<Prisma.OnboardingRequestWhereInput | null> {
    const notDraft: Prisma.OnboardingRequestWhereInput = {
      status: { not: 'DRAFT' },
      userId: { not: user.id },
    };
    const reach = await this.policy.reach(user, 'onboarding.review');
    if (reach.platform) return notDraft;
    const or: Prisma.OnboardingRequestWhereInput[] = [];
    const direct = reach.organizations.map((o) => o.organizationId);
    const roots = reach.organizations.filter((o) => o.withDescendants).map((o) => o.organizationId);
    const descendants =
      roots.length > 0
        ? (
            await this.db.organizationClosure.findMany({
              where: { ancestorId: { in: roots } },
              select: { descendantId: true },
            })
          ).map((r) => r.descendantId)
        : [];
    const orgs = [...new Set([...direct, ...descendants])];
    if (orgs.length > 0) or.push({ organizationId: { in: orgs } });
    const coach = await this.coaches.reviewingOrganizations(user);
    if (coach && coach.organizationIds.length > 0)
      or.push({ role: 'ATHLETE', coachId: coach.coachId, organizationId: { in: coach.organizationIds } });
    return or.length > 0 ? { AND: [notDraft, { OR: or }] } : null;
  }
}
