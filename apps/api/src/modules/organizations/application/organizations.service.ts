// Организации: список, карточка, создание, изменение, переходы статуса (API.md, 3.4).
import { Injectable } from '@nestjs/common';
import {
  type Organization as OrganizationDto,
  type OrganizationInput,
  type OrganizationPatch,
  type OrganizationsQuery,
  type OrganizationSummary,
  type OrganizationTransitionRequest,
  type Page,
  type PermissionCode,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';
import { OutboxService } from '../../outbox';
import { checkTransition, creatorRole, ORGANIZATION_TRANSITIONS, slugify } from '../domain/organization-rules';
import { ClosureRepository } from '../infrastructure/closure.repository';
import { ORGANIZATION_INCLUDE, type OrganizationRow, toDetail, toSummary } from './organization-mapper';
import { OrganizationScopeService } from './organization-scope.service';

const ACTION_CANDIDATES: PermissionCode[] = [
  'organization.update',
  'organization.members.view',
  'organization.members.manage',
  'organization.create_child',
];

const today = (): Date => new Date(new Date().toISOString().slice(0, 10));

const auditView = (o: OrganizationRow): Record<string, unknown> => ({
  type: o.type,
  parentId: o.parentId,
  name: o.name,
  shortName: o.shortName,
  slug: o.slug,
  status: o.status,
  countryCode: o.countryCode,
  regionId: o.regionId,
  city: o.city,
  address: o.address,
  contactEmail: o.contactEmail,
  contactPhone: o.contactPhone,
  website: o.website,
  logoFileId: o.logoFileId,
  legalDetails: o.legalDetails ? { inn: o.legalDetails.inn } : null,
});

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly closure: ClosureRepository,
    private readonly scopes: OrganizationScopeService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FilesService,
  ) {}

  private publicUrl = (key: string): string => this.files.publicUrl(key);

  /** Видимость: активные — всем; прочие — участникам организации и её предков, платформе (PERMISSIONS.md, 6). */
  async list(user: AuthUser, q: OrganizationsQuery): Promise<Page<OrganizationSummary>> {
    const grants = await this.policy.grants(user);
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      type: q.type,
      regionId: q.regionId,
      parentId: q.parentId,
      status: q.status,
    };
    const and: Prisma.OrganizationWhereInput[] = [];
    if (grants.platform.length === 0) {
      const memberOrgIds = grants.organizations.map((g) => g.organizationId);
      and.push({ OR: [{ status: 'ACTIVE' }, { ancestors: { some: { ancestorId: { in: memberOrgIds } } } }] });
    }
    if (q.q) {
      const needle = q.q.toLowerCase().replaceAll('ё', 'е');
      const ids = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM organization
        WHERE deleted_at IS NULL AND (name_norm LIKE ${'%' + needle + '%'} OR name_norm % ${needle} OR lower(short_name) LIKE ${'%' + needle + '%'})
        LIMIT 1000`;
      and.push({ id: { in: ids.map((r) => r.id) } });
    }
    const cursor = decodeCursor(q.cursor);
    if (cursor) and.push({ OR: [{ name: { gt: cursor.k } }, { name: cursor.k, id: { gt: cursor.id } }] });
    const rows = await this.db.organization.findMany({
      where: { ...where, AND: and },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: ORGANIZATION_INCLUDE,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.name, id: r.id }), (r) => toSummary(r, this.publicUrl));
  }

  async get(user: AuthUser, id: string): Promise<OrganizationDto> {
    const scope = await this.scopes.scopeOf(id);
    if (!(await this.policy.isVisible(user, scope))) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const row = await this.db.organization.findUniqueOrThrow({ where: { id }, include: { ...ORGANIZATION_INCLUDE, legalDetails: true } });
    return this.detail(user, row, scope);
  }

  private async detail(user: AuthUser, row: OrganizationRow, scope: ResourceScope): Promise<OrganizationDto> {
    const actions: string[] = await this.policy.allowedActions(user, scope, ACTION_CANDIDATES);
    const approveScope = await this.scopes.parentScopeOf(row.id);
    if (await this.policy.can(user, 'organization.approve', approveScope)) {
      actions.push('organization.approve');
      for (const t of ORGANIZATION_TRANSITIONS.filter((x) => x.from === row.status)) actions.push(`transition:${t.to}`);
    }
    return toDetail(row, this.publicUrl, { includeLegal: actions.includes('organization.update'), allowedActions: actions });
  }

  private async uniqueSlug(tx: Tx, requested: string | undefined, name: string, excludeId?: string): Promise<string> {
    const taken = async (slug: string): Promise<boolean> =>
      (await tx.organization.findFirst({ where: { slug, id: excludeId ? { not: excludeId } : undefined }, select: { id: true } })) !== null;
    if (requested) {
      if (await taken(requested)) throw new DomainError('SLUG_TAKEN');
      return requested;
    }
    const base = slugify(name);
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? base : `${base.slice(0, 74)}-${i}`;
      if (!(await taken(candidate))) return candidate;
    }
    return `${base.slice(0, 60)}-${uuidv7().slice(-8)}`;
  }

  private async assertRegion(tx: Tx, regionId: string | null | undefined, countryCode: string): Promise<void> {
    if (!regionId) return;
    const region = await tx.region.findUnique({ where: { id: regionId } });
    if (!region || region.countryCode !== countryCode) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'regionId', code: 'invalid_region' }] });
    }
  }

  private async assertCountry(tx: Tx, countryCode: string): Promise<void> {
    if (!(await tx.country.findUnique({ where: { code: countryCode } }))) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'countryCode', code: 'invalid_country' }] });
    }
  }

  /** Родитель должен существовать, быть виден и активен. Возвращает, можно ли сразу активировать дочернюю. */
  private async resolveParent(user: AuthUser, parentId: string | null | undefined): Promise<{ canActivate: boolean }> {
    if (!parentId) return { canActivate: await this.policy.can(user, 'organization.approve', { kind: 'PLATFORM' }) };
    const parent = await this.db.organization.findFirst({ where: { id: parentId, deletedAt: null } });
    const scope = parent ? await this.scopes.scopeOf(parent.id) : null;
    if (!parent || !scope || !(await this.policy.isVisible(user, scope))) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'parentId', code: 'not_found' }] });
    }
    if (parent.status !== 'ACTIVE') throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: parent.id });
    return { canActivate: await this.policy.can(user, 'organization.create_child', scope) };
  }

  async create(user: AuthUser, input: OrganizationInput): Promise<OrganizationDto> {
    const { canActivate } = await this.resolveParent(user, input.parentId);
    const id = await this.db.tx(async (tx) => {
      await this.assertCountry(tx, input.countryCode);
      await this.assertRegion(tx, input.regionId, input.countryCode);
      if (input.logoFileId) await this.files.assertAttachable(tx, input.logoFileId, user.id, 'ORGANIZATION_LOGO', 'logoFileId');
      const orgId = uuidv7();
      const slug = await this.uniqueSlug(tx, input.slug, input.shortName || input.name);
      const status = canActivate ? 'ACTIVE' : 'PENDING_REVIEW';
      const created = await tx.organization.create({
        data: {
          id: orgId,
          type: input.type,
          parentId: input.parentId ?? null,
          name: input.name,
          shortName: input.shortName,
          slug,
          countryCode: input.countryCode,
          regionId: input.regionId ?? null,
          city: input.city ?? null,
          address: input.address ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          website: input.website ?? null,
          logoFileId: input.logoFileId ?? null,
          status,
          createdById: user.id,
          legalDetails: input.legalDetails ? { create: { ...input.legalDetails } } : undefined,
        },
        include: { ...ORGANIZATION_INCLUDE, legalDetails: true },
      });
      await this.closure.insertNode(tx, orgId, input.parentId ?? null);
      const role = await tx.role.findUniqueOrThrow({ where: { code: creatorRole(input.type) } });
      await tx.organizationMembership.create({
        data: { id: uuidv7(), organizationId: orgId, userId: user.id, roleId: role.id, status: 'ACTIVE', validFrom: today(), invitedById: user.id },
      });
      await tx.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'organization.created',
        entityType: 'Organization',
        entityId: orgId,
        organizationId: orgId,
        after: auditView(created),
      });
      await this.outbox.enqueue(tx, { type: 'organization.created', aggregate: { type: 'Organization', id: orgId }, payload: { organizationId: orgId } });
      return orgId;
    });
    const fresh = { ...user, permissionsVersion: user.permissionsVersion + 1 };
    return this.get(fresh, id);
  }

  async update(user: AuthUser, id: string, version: number, patch: OrganizationPatch): Promise<OrganizationDto> {
    const current = await this.db.organization.findFirst({ where: { id, deletedAt: null }, include: { ...ORGANIZATION_INCLUDE, legalDetails: true } });
    if (!current) throw new DomainError('NOT_FOUND', { resource: 'organization' });
    if (patch.type !== undefined && patch.type !== current.type && !(await this.policy.can(user, 'organization.approve', { kind: 'PLATFORM' }))) {
      throw new DomainError('FORBIDDEN', { field: 'type' });
    }
    const parentChanged = patch.parentId !== undefined && (patch.parentId ?? null) !== current.parentId;
    if (parentChanged) {
      const { canActivate } = await this.resolveParent(user, patch.parentId);
      if (!canActivate) throw new DomainError('FORBIDDEN', { field: 'parentId' });
    }
    await this.db.tx(async (tx) => {
      const countryCode = patch.countryCode ?? current.countryCode;
      if (patch.countryCode) await this.assertCountry(tx, patch.countryCode);
      if (patch.regionId !== undefined || patch.countryCode) await this.assertRegion(tx, patch.regionId ?? current.regionId, countryCode);
      if (patch.logoFileId && patch.logoFileId !== current.logoFileId) {
        await this.files.assertAttachable(tx, patch.logoFileId, user.id, 'ORGANIZATION_LOGO', 'logoFileId');
      }
      if (parentChanged && patch.parentId && (patch.parentId === id || (await this.closure.isDescendant(tx, patch.parentId, id)))) {
        throw new DomainError('ORGANIZATION_HIERARCHY_CYCLE');
      }
      const slug = patch.slug && patch.slug !== current.slug ? await this.uniqueSlug(tx, patch.slug, current.name, id) : undefined;
      const { count } = await tx.organization.updateMany({
        where: { id, version },
        data: {
          type: patch.type,
          parentId: parentChanged ? (patch.parentId ?? null) : undefined,
          name: patch.name,
          shortName: patch.shortName,
          slug,
          countryCode: patch.countryCode,
          regionId: patch.regionId,
          city: patch.city,
          address: patch.address,
          contactEmail: patch.contactEmail,
          contactPhone: patch.contactPhone,
          website: patch.website,
          logoFileId: patch.logoFileId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict(current.version);
      if (patch.legalDetails === null) await tx.organizationLegalDetails.deleteMany({ where: { organizationId: id } });
      if (patch.legalDetails) {
        await tx.organizationLegalDetails.upsert({
          where: { organizationId: id },
          create: { organizationId: id, ...patch.legalDetails },
          update: { kpp: null, ogrn: null, ...patch.legalDetails },
        });
      }
      if (parentChanged) await this.closure.move(tx, id, patch.parentId ?? null);
      const after = await tx.organization.findUniqueOrThrow({ where: { id }, include: { ...ORGANIZATION_INCLUDE, legalDetails: true } });
      await this.audit.record(tx, {
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: id,
        organizationId: id,
        before: auditView(current),
        after: auditView(after),
      });
    });
    return this.get(user, id);
  }

  async transition(user: AuthUser, id: string, version: number, req: OrganizationTransitionRequest): Promise<OrganizationDto> {
    await this.db.tx(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id, deletedAt: null } });
      if (!org) throw new DomainError('NOT_FOUND', { resource: 'organization' });
      const check = checkTransition(ORGANIZATION_TRANSITIONS, org.status, req.to);
      if (!check.ok) throw new DomainError('INVALID_TRANSITION', { from: org.status, to: req.to, allowed: check.allowed });
      if (check.reasonRequired && !req.reason) throw new DomainError('REASON_REQUIRED');
      const { count } = await tx.organization.updateMany({ where: { id, version }, data: { status: req.to, version: { increment: 1 } } });
      if (count === 0) throw versionConflict(org.version);
      const members = await this.closure.memberUserIds(tx, [id]);
      if (members.length > 0) await tx.user.updateMany({ where: { id: { in: members } }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'organization.status_changed',
        entityType: 'Organization',
        entityId: id,
        organizationId: id,
        before: { status: org.status },
        after: { status: req.to },
        reason: req.reason ?? null,
      });
      await this.outbox.enqueue(tx, {
        type: 'organization.status_changed',
        aggregate: { type: 'Organization', id },
        payload: { organizationId: id, from: org.status, to: req.to },
      });
    });
    return this.get(user, id);
  }
}
