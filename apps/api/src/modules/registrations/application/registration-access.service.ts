// Доступ к заявкам и участиям (PERMISSIONS.md, 5): владелец заявки — организация с `registration.create`
// (APPLICATION_OWNER), персонал турнира — по турнирным правам. Остальным заявка не видна (404).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PermissionCode } from '@sde/contracts';
import type { Application, Entry } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { type CompetitionBasics, type CompetitionScope, CompetitionScopeService } from '../../competitions';
import { OrganizationScopeService } from '../../organizations';

export interface ApplicationContext {
  application: Application;
  competition: CompetitionBasics;
  competitionScope: CompetitionScope;
}

@Injectable()
export class RegistrationAccessService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly registry: ScopeResolverRegistry,
    private readonly competitions: CompetitionScopeService,
    private readonly orgScopes: OrganizationScopeService,
  ) {}

  onModuleInit(): void {
    this.registry.register('application', async (id) => (await this.applicationContext(id)).competitionScope);
    this.registry.register('entry', async (id) => (await this.entryContext(id)).competitionScope);
  }

  async applicationContext(id: string | undefined): Promise<ApplicationContext> {
    const application = id ? await this.db.application.findUnique({ where: { id } }) : null;
    if (!application) throw new DomainError('NOT_FOUND', { resource: 'application' });
    const competition = await this.competitions.require(application.competitionId);
    return { application, competition, competitionScope: await this.competitions.scopeFor(competition) };
  }

  async entryContext(id: string | undefined): Promise<ApplicationContext & { entry: Entry }> {
    const entry = id ? await this.db.entry.findUnique({ where: { id } }) : null;
    if (!entry) throw new DomainError('NOT_FOUND', { resource: 'entry' });
    return { entry, ...(await this.applicationContext(entry.applicationId)) };
  }

  async organizationScope(organizationId: string): Promise<ResourceScope> {
    return this.orgScopes.scopeOf(organizationId);
  }

  /** APPLICATION_OWNER: у пользователя есть `registration.create` в организации заявки. */
  async isOwner(user: AuthUser, organizationId: string): Promise<boolean> {
    return this.policy.can(user, 'registration.create', await this.orgScopes.scopeOf(organizationId));
  }

  async canStaff(user: AuthUser, permission: PermissionCode, scope: CompetitionScope): Promise<boolean> {
    return this.policy.can(user, permission, scope);
  }

  /** Заявку видят владелец и персонал с `registration.view`; остальным — 404. */
  async assertVisible(user: AuthUser, ctx: ApplicationContext): Promise<{ owner: boolean; staff: boolean }> {
    const owner = await this.isOwner(user, ctx.application.organizationId);
    const staff = await this.canStaff(user, 'registration.view', ctx.competitionScope);
    if (!owner && !staff) throw new DomainError('NOT_FOUND', { resource: 'application' });
    return { owner, staff };
  }

  /** Команда владельца: не владелец, но видит заявку — 403; не видит — 404. */
  async assertOwner(user: AuthUser, ctx: ApplicationContext): Promise<void> {
    if (await this.isOwner(user, ctx.application.organizationId)) return;
    if (await this.canStaff(user, 'registration.view', ctx.competitionScope))
      throw new DomainError('FORBIDDEN', { reason: 'not_application_owner' });
    throw new DomainError('NOT_FOUND', { resource: 'application' });
  }

  /**
   * Команда персонала: право в турнире. Владелец заявки или персонал без этого права получают 403, остальные —
   * 404: о чужой заявке не сообщается. Возвращает, получено ли право через платформенную роль.
   */
  async assertStaff(user: AuthUser, permission: PermissionCode, ctx: ApplicationContext): Promise<boolean> {
    if (await this.canStaff(user, permission, ctx.competitionScope))
      return (await this.policy.assert(user, permission, ctx.competitionScope)).viaPlatform;
    await this.assertVisible(user, ctx);
    throw new DomainError('FORBIDDEN', { permission });
  }

  /** Организации, где пользователь подаёт заявки; `all` — платформенная роль. */
  async ownerOrganizations(user: AuthUser): Promise<string[] | 'all'> {
    const reach = await this.policy.reach(user, 'registration.create');
    if (reach.platform) return 'all';
    return reach.organizations.map((o) => o.organizationId);
  }
}
