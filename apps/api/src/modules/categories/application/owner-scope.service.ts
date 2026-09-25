// Владелец справочной записи правил: платформа (шаблон для всех) или организация. Право `category.manage`
// проверяется в области владельца; области регистрируются для маршрутов по идентификатору записи.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import type { AuthUser } from '../../../common/context/request-context';
import { OrganizationScopeService } from '../../organizations';

@Injectable()
export class OwnerScopeService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly registry: ScopeResolverRegistry,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit(): void {
    this.registry.register('ageGroup', async (id) => {
      const g = id ? await this.db.ageGroup.findFirst({ where: { id, deletedAt: null } }) : null;
      if (!g) throw new DomainError('NOT_FOUND', { resource: 'age_group' });
      return this.scopeOf(g.ownerOrganizationId);
    });
    this.registry.register('weightCategory', async (id) => {
      const w = id
        ? await this.db.weightCategory.findFirst({
            where: { id, deletedAt: null },
            include: { ageGroup: true },
          })
        : null;
      if (!w) throw new DomainError('NOT_FOUND', { resource: 'weight_category' });
      return this.scopeOf(w.ageGroup.ownerOrganizationId);
    });
    this.registry.register('categoryTemplate', async (id) => {
      const t = id ? await this.db.categoryTemplate.findFirst({ where: { id, deletedAt: null } }) : null;
      if (!t) throw new DomainError('NOT_FOUND', { resource: 'category_template' });
      return this.scopeOf(t.ownerOrganizationId);
    });
  }

  scopeOf(ownerOrganizationId: string | null): Promise<ResourceScope> {
    return ownerOrganizationId
      ? this.orgScopes.scopeOf(ownerOrganizationId)
      : Promise.resolve({ kind: 'PLATFORM' });
  }

  /** Владелец из тела запроса: организация должна быть видна, право — в её области. */
  async assertManage(user: AuthUser, ownerOrganizationId: string | null | undefined): Promise<void> {
    const scope = await this.scopeOf(ownerOrganizationId ?? null);
    if (scope.kind !== 'PLATFORM' && !(await this.policy.isVisible(user, scope)))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    await this.policy.assert(user, 'category.manage', scope);
  }

  async canManage(user: AuthUser, ownerOrganizationId: string | null): Promise<boolean> {
    return this.policy.can(user, 'category.manage', await this.scopeOf(ownerOrganizationId));
  }

  /** Организация-владелец и её предки: шаблоны федерации доступны дочерним организациям. */
  async ownerLineage(ownerOrganizationId: string | null): Promise<string[]> {
    if (!ownerOrganizationId) return [];
    const scope = await this.orgScopes.scopeOf(ownerOrganizationId);
    return scope.kind === 'ORGANIZATION' ? scope.ancestorIds : [];
  }
}
