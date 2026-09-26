// Места проведения (API.md, 5.1; DATABASE.md, 3.4): зал с адресом и часовым поясом. Место принадлежит
// организации; турниры организации и её дочерних организаций выбирают его в положении.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { VenueDto, VenueInput, VenuePatch, VenuesQuery } from '@sde/contracts';
import { type Prisma, type Venue, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { AuditService } from '../../audit';
import { OrganizationScopeService } from '../../organizations';

@Injectable()
export class VenuesService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly registry: ScopeResolverRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register('venue', (id) => this.scopeOf(id));
  }

  async scopeOf(id: string | undefined): Promise<ResourceScope> {
    const venue = id ? await this.db.venue.findFirst({ where: { id, deletedAt: null } }) : null;
    if (!venue) throw new DomainError('NOT_FOUND', { resource: 'venue' });
    return this.orgScopes.scopeOf(venue.ownerOrganizationId);
  }

  private toDto(v: Venue, allowedActions: string[]): VenueDto {
    return {
      id: v.id,
      name: v.name,
      address: v.address,
      city: v.city,
      ownerOrganizationId: v.ownerOrganizationId,
      regionId: v.regionId,
      timezone: v.timezone,
      allowedActions,
    };
  }

  /**
   * Места организаций, где у пользователя есть `venue.manage`, и их предков (места федерации доступны
   * турнирам дочерних организаций). Фильтр `ownerOrganizationId` — места для турнира этой организации.
   */
  async list(user: AuthUser, q: VenuesQuery): Promise<VenueDto[]> {
    const reach = await this.policy.reach(user, 'venue.manage');
    const where: Prisma.VenueWhereInput = { deletedAt: null };
    if (q.ownerOrganizationId) {
      const scope = await this.orgScopes.scopeOf(q.ownerOrganizationId);
      if (!reach.platform && !(await this.policy.can(user, 'venue.manage', scope)))
        throw new DomainError('FORBIDDEN', { permission: 'venue.manage' });
      where.ownerOrganizationId = { in: scope.ancestorIds };
    } else if (!reach.platform) {
      where.ownerOrganizationId = { in: reach.organizations.map((o) => o.organizationId) };
    }
    const rows = await this.db.venue.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((v) => this.toDto(v, ['venue.manage']));
  }

  async create(user: AuthUser, input: VenueInput): Promise<VenueDto> {
    await this.policy.assert(user, 'venue.manage', await this.orgScopes.scopeOf(input.ownerOrganizationId));
    const venue = await this.db.tx(async (tx) => {
      if (input.regionId && !(await tx.region.findUnique({ where: { id: input.regionId } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'regionId', code: 'invalid_region' }],
        });
      const created = await tx.venue.create({
        data: {
          id: uuidv7(),
          ownerOrganizationId: input.ownerOrganizationId,
          name: input.name,
          address: input.address ?? null,
          city: input.city ?? null,
          regionId: input.regionId ?? null,
          timezone: input.timezone,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'venue.created',
        entityType: 'Venue',
        entityId: created.id,
        organizationId: input.ownerOrganizationId,
        after: { name: created.name, city: created.city, timezone: created.timezone },
      });
      return created;
    });
    return this.toDto(venue, ['venue.manage']);
  }

  async update(id: string, patch: VenuePatch): Promise<VenueDto> {
    const venue = await this.db.tx(async (tx) => {
      const current = await tx.venue.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'venue' });
      if (patch.regionId && !(await tx.region.findUnique({ where: { id: patch.regionId } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'regionId', code: 'invalid_region' }],
        });
      const updated = await tx.venue.update({ where: { id }, data: patch });
      await this.audit.record(tx, {
        action: 'venue.updated',
        entityType: 'Venue',
        entityId: id,
        organizationId: current.ownerOrganizationId,
        before: Object.fromEntries(
          Object.keys(patch).map((k) => [k, (current as Record<string, unknown>)[k] ?? null]),
        ),
        after: patch,
      });
      return updated;
    });
    return this.toDto(venue, ['venue.manage']);
  }
}
