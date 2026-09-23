// Администрирование пользователей и платформенных ролей (API.md, 3.3).
import { Injectable } from '@nestjs/common';
import {
  type AdminUser,
  type AdminUsersQuery,
  type AssignPlatformRoleRequest,
  isRoleCode,
  type Page,
  type PermissionDto,
  PERMISSIONS,
  permissionModule,
  type PermissionCode,
  ROLE_CODES,
  ROLE_PERMISSIONS,
  ROLES,
  type RoleCode,
  type RoleDto,
} from '@sde/contracts';
import { type Prisma, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { SessionService } from '../../auth';
import { OutboxService } from '../../outbox';

const USER_INCLUDE = {
  platformRoles: { where: { revokedAt: null }, select: { role: { select: { code: true } } } },
  organizationMemberships: {
    where: { status: { in: ['INVITED', 'ACTIVE', 'SUSPENDED'] } },
    select: { organizationId: true, status: true, role: { select: { code: true } }, organization: { select: { name: true } } },
  },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    status: u.status,
    locale: u.locale === 'en' ? 'en' : 'ru',
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    totpEnabled: u.totpEnabledAt !== null,
    platformRoles: u.platformRoles.map((p) => p.role.code).filter(isRoleCode),
    organizations: u.organizationMemberships
      .filter((m) => isRoleCode(m.role.code))
      .map((m) => ({ organizationId: m.organizationId, organizationName: m.organization.name, role: m.role.code as RoleCode, status: m.status })),
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
  ) {}

  async list(q: AdminUsersQuery): Promise<Page<AdminUser>> {
    const cursor = decodeCursor(q.cursor);
    const and: Prisma.UserWhereInput[] = [{ deletedAt: null }];
    if (q.status) and.push({ status: q.status });
    if (q.q) and.push({ OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }] });
    if (q.role) {
      and.push({
        OR: [
          { platformRoles: { some: { revokedAt: null, role: { code: q.role } } } },
          { organizationMemberships: { some: { status: 'ACTIVE', role: { code: q.role } } } },
          { competitionMemberships: { some: { status: 'ACTIVE', role: { code: q.role } } } },
        ],
      });
    }
    if (cursor) and.push({ OR: [{ createdAt: { lt: new Date(cursor.k) } }, { createdAt: new Date(cursor.k), id: { lt: cursor.id } }] });
    const rows = await this.db.user.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: USER_INCLUDE,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }), toAdminUser);
  }

  async get(id: string): Promise<AdminUser> {
    const user = await this.db.user.findFirst({ where: { id, deletedAt: null }, include: USER_INCLUDE });
    if (!user) throw new DomainError('NOT_FOUND', { resource: 'user' });
    return toAdminUser(user);
  }

  /** Блокировка отзывает все сессии пользователя сразу (API.md, 3.3; SECURITY.md, 3.1). */
  async block(actor: AuthUser, id: string, reason: string): Promise<AdminUser> {
    if (actor.id === id) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['cannot_block_self'] });
    const revoked = await this.db.tx(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw new DomainError('NOT_FOUND', { resource: 'user' });
      if (user.status === 'BLOCKED') throw new DomainError('INVALID_TRANSITION', { from: 'BLOCKED', to: 'BLOCKED', allowed: ['ACTIVE'] });
      await tx.user.update({ where: { id }, data: { status: 'BLOCKED', permissionsVersion: { increment: 1 } } });
      const families = await this.sessions.revokeAll(tx, id, 'account_blocked');
      await this.audit.record(tx, { action: 'user.blocked', entityType: 'User', entityId: id, before: { status: user.status }, after: { status: 'BLOCKED' }, reason });
      await this.outbox.enqueue(tx, { type: 'user.blocked', aggregate: { type: 'User', id }, payload: { userId: id } });
      return families;
    });
    await this.sessions.blockSessions(revoked);
    return this.get(id);
  }

  async unblock(id: string, reason: string): Promise<AdminUser> {
    await this.db.tx(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw new DomainError('NOT_FOUND', { resource: 'user' });
      if (user.status !== 'BLOCKED') throw new DomainError('INVALID_TRANSITION', { from: user.status, to: 'ACTIVE', allowed: [] });
      const next = user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
      await tx.user.update({ where: { id }, data: { status: next, permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, { action: 'user.unblocked', entityType: 'User', entityId: id, before: { status: 'BLOCKED' }, after: { status: next }, reason });
    });
    return this.get(id);
  }

  /** Платформенная роль — только пользователю с включённым TOTP (ARCHITECTURE.md, 6). */
  async assignPlatformRole(actor: AuthUser, id: string, req: AssignPlatformRoleRequest): Promise<AdminUser> {
    await this.db.tx(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw new DomainError('NOT_FOUND', { resource: 'user' });
      if (!user.totpEnabledAt) throw new DomainError('TOTP_REQUIRED', { reason: 'recipient_without_totp' });
      const role = await tx.role.findUniqueOrThrow({ where: { code: req.roleCode } });
      const existing = await tx.platformRoleAssignment.findFirst({ where: { userId: id, roleId: role.id, revokedAt: null } });
      if (existing) throw new DomainError('ALREADY_EXISTS', { resource: 'platform_role' });
      await tx.platformRoleAssignment.create({ data: { id: uuidv7(), userId: id, roleId: role.id, grantedById: actor.id } });
      await tx.user.update({ where: { id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, { action: 'user.platform_role_granted', entityType: 'User', entityId: id, after: { roleCode: req.roleCode }, reason: req.reason });
    });
    return this.get(id);
  }

  /** Нельзя снять последнего SUPER_ADMIN — иначе платформой некому управлять. */
  async revokePlatformRole(id: string, roleCode: string, reason: string): Promise<void> {
    if (!isRoleCode(roleCode) || ROLES[roleCode].scope !== 'PLATFORM') throw new DomainError('NOT_FOUND', { resource: 'platform_role' });
    await this.db.tx(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: roleCode } });
      const assignment = await tx.platformRoleAssignment.findFirst({ where: { userId: id, roleId: role.id, revokedAt: null } });
      if (!assignment) throw new DomainError('NOT_FOUND', { resource: 'platform_role' });
      if (roleCode === 'SUPER_ADMIN') {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('platform-role:SUPER_ADMIN'))`;
        const remaining = await tx.platformRoleAssignment.count({ where: { roleId: role.id, revokedAt: null, user: { status: 'ACTIVE' } } });
        if (remaining <= 1) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['last_super_admin'] });
      }
      await tx.platformRoleAssignment.update({ where: { id: assignment.id }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, { action: 'user.platform_role_revoked', entityType: 'User', entityId: id, before: { roleCode }, reason });
    });
  }

  roles(): RoleDto[] {
    return ROLE_CODES.map((code) => ({
      code,
      scope: ROLES[code].scope,
      isSystem: true,
      nameKey: ROLES[code].nameKey,
      permissions: (Object.entries(ROLE_PERMISSIONS[code]) as [PermissionCode, RoleDto['permissions'][number]['mode']][]).map(([p, mode]) => ({
        code: p,
        mode,
      })),
    }));
  }

  permissions(): PermissionDto[] {
    return (Object.keys(PERMISSIONS) as PermissionCode[]).map((code) => ({
      code,
      module: permissionModule(code),
      description: PERMISSIONS[code].description,
      scopes: [...PERMISSIONS[code].scopes],
    }));
  }
}
