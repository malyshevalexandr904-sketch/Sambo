// Область организации для проверки прав (PERMISSIONS.md, 6.2): ресурс загружается сервером по id из пути.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type ResourceScope, ScopeResolverRegistry } from '../../access';
import { ClosureRepository } from '../infrastructure/closure.repository';

export type OrganizationScope = Extract<ResourceScope, { kind: 'ORGANIZATION' }>;

@Injectable()
export class OrganizationScopeService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly closure: ClosureRepository,
    private readonly registry: ScopeResolverRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('organization', (id) => this.scopeOf(id));
    this.registry.register('organizationParent', (id) => this.parentScopeOf(id));
  }

  async scopeOf(id: string | undefined): Promise<OrganizationScope> {
    if (!id) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const org = await this.db.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!org) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    return {
      kind: 'ORGANIZATION',
      organizationId: org.id,
      ancestorIds: await this.closure.ancestors(this.db, org.id),
      visibleToAll: org.status === 'ACTIVE',
    };
  }

  /** Активация и приостановка решаются на уровне родителя (федерации) или платформы (API.md, 3.4). */
  async parentScopeOf(id: string | undefined): Promise<ResourceScope> {
    if (!id) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const org = await this.db.organization.findFirst({
      where: { id, deletedAt: null },
      select: { parentId: true },
    });
    if (!org) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    return org.parentId ? this.scopeOf(org.parentId) : { kind: 'PLATFORM' };
  }
}
