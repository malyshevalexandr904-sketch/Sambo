// Участники организации: приглашения, принятие, приостановка и исключение (API.md, 3.4).
import { Inject, Injectable } from '@nestjs/common';
import {
  type InviteMemberRequest,
  isRoleCode,
  type Locale,
  type MembersQuery,
  type Membership,
  type MembershipPatch,
  type Page,
  ROLES,
  type RoleCode,
} from '@sde/contracts';
import { type OrganizationMembership, type Prisma, type Role, uuidv7 } from '@sde/db';
import type { Env } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { grantablePermissions, missingPermissionsForRole, PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { INVITE_TTL_SECONDS, VerificationTokenService } from '../../auth';
import { EmailRequestService } from '../../outbox';
import { checkTransition, MEMBERSHIP_TRANSITIONS } from '../domain/organization-rules';
import { OrganizationScopeService } from './organization-scope.service';

type MembershipRow = OrganizationMembership & {
  role: Role;
  user: { id: string; displayName: string; email: string | null } | null;
};

const MEMBER_INCLUDE = {
  role: true,
  user: { select: { id: true, displayName: true, email: true } },
} as const;

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function toDto(m: MembershipRow): Membership {
  return {
    id: m.id,
    organizationId: m.organizationId,
    user: m.user,
    invitedEmail: m.userId ? null : m.invitedEmail,
    roleCode: m.role.code as RoleCode,
    status: m.status,
    validFrom: dateOnly(m.validFrom),
    validTo: dateOnly(m.validTo),
    version: m.version,
    createdAt: m.createdAt.toISOString(),
  };
}

@Injectable()
export class MembersService {
  constructor(
    private readonly db: PrismaService,
    private readonly scopes: OrganizationScopeService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly tokens: VerificationTokenService,
    private readonly emails: EmailRequestService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(organizationId: string, q: MembersQuery): Promise<Page<Membership>> {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.OrganizationMembershipWhereInput = {
      organizationId,
      status: q.status,
      role: q.role ? { code: q.role } : undefined,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: new Date(cursor.k) } },
              { createdAt: new Date(cursor.k), id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.db.organizationMembership.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: MEMBER_INCLUDE,
    });
    return toPage(rows, q.limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }), toDto);
  }

  /** Нельзя выдать роль с правами шире своих (API.md, 3.4). */
  private async assertCanGrant(user: AuthUser, organizationId: string, role: RoleCode): Promise<void> {
    if (ROLES[role].scope !== 'ORGANIZATION')
      throw new DomainError('ROLE_SCOPE_MISMATCH', { roleCode: role });
    const scope = await this.scopes.scopeOf(organizationId);
    const missing = missingPermissionsForRole(
      grantablePermissions(await this.policy.grants(user), scope),
      role,
    );
    if (missing.length > 0) throw new DomainError('ROLE_EXCEEDS_GRANTOR', { roleCode: role, missing });
  }

  async invite(
    user: AuthUser,
    organizationId: string,
    req: InviteMemberRequest,
    locale: Locale,
  ): Promise<Membership> {
    await this.assertCanGrant(user, organizationId, req.roleCode);
    const created = await this.db.tx(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      if (org.status === 'ARCHIVED' || org.status === 'SUSPENDED')
        throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId });
      const role = await tx.role.findUniqueOrThrow({ where: { code: req.roleCode } });
      const existing = await tx.organizationMembership.findFirst({
        where: {
          organizationId,
          roleId: role.id,
          status: { in: ['INVITED', 'ACTIVE'] },
          OR: [{ invitedEmail: req.email }, { user: { email: req.email } }],
        },
      });
      if (existing) throw new DomainError('ALREADY_EXISTS', { resource: 'membership' });
      const membership = await tx.organizationMembership.create({
        data: {
          id: uuidv7(),
          organizationId,
          invitedEmail: req.email,
          roleId: role.id,
          status: 'INVITED',
          invitedById: user.id,
        },
        include: MEMBER_INCLUDE,
      });
      const token = await this.tokens.issue(tx, 'INVITE', {
        userId: null,
        ttlSeconds: INVITE_TTL_SECONDS,
        payload: { membershipId: membership.id },
      });
      await this.emails.request(tx, {
        template: 'organization.invite',
        to: req.email,
        userId: null,
        locale,
        params: {
          organizationName: org.name,
          roleCode: req.roleCode,
          acceptUrl: `${this.env.APP_URL.replace(/\/$/, '')}/${locale}/invites/accept?token=${encodeURIComponent(token)}`,
        },
      });
      await this.audit.record(tx, {
        action: 'organization.member_invited',
        entityType: 'OrganizationMembership',
        entityId: membership.id,
        organizationId,
        after: { roleCode: req.roleCode, status: 'INVITED', invitedEmail: req.email },
      });
      return membership;
    });
    return toDto(created);
  }

  /** Принять приглашение может только владелец приглашённого email, подтвердивший его. */
  async accept(user: AuthUser, token: string): Promise<Membership> {
    const accepted = await this.db.tx(async (tx) => {
      const consumed = await this.tokens.consume(tx, 'INVITE', token);
      const payload = consumed.payload as { membershipId?: unknown } | null;
      const membershipId = typeof payload?.membershipId === 'string' ? payload.membershipId : null;
      const membership = membershipId
        ? await tx.organizationMembership.findUnique({ where: { id: membershipId }, include: MEMBER_INCLUDE })
        : null;
      if (!membership || membership.status !== 'INVITED') throw new DomainError('TOKEN_EXPIRED');
      if (
        !user.emailVerified ||
        !user.email ||
        user.email.toLowerCase() !== membership.invitedEmail?.toLowerCase()
      ) {
        throw new DomainError('FORBIDDEN', { reason: 'invite_email_mismatch' });
      }
      const duplicate = await tx.organizationMembership.findFirst({
        where: {
          organizationId: membership.organizationId,
          userId: user.id,
          roleId: membership.roleId,
          status: { in: ['INVITED', 'ACTIVE'] },
        },
      });
      if (duplicate) throw new DomainError('ALREADY_EXISTS', { resource: 'membership' });
      const updated = await tx.organizationMembership.update({
        where: { id: membership.id },
        data: {
          userId: user.id,
          status: 'ACTIVE',
          validFrom: new Date(new Date().toISOString().slice(0, 10)),
          version: { increment: 1 },
        },
        include: MEMBER_INCLUDE,
      });
      await tx.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'organization.member_joined',
        entityType: 'OrganizationMembership',
        entityId: membership.id,
        organizationId: membership.organizationId,
        before: { status: 'INVITED' },
        after: { status: 'ACTIVE', userId: user.id },
      });
      return updated;
    });
    return toDto(accepted);
  }

  async update(
    user: AuthUser,
    organizationId: string,
    membershipId: string,
    version: number,
    patch: MembershipPatch,
  ): Promise<Membership> {
    const current = await this.db.organizationMembership.findFirst({
      where: { id: membershipId, organizationId },
      include: MEMBER_INCLUDE,
    });
    if (!current) throw new DomainError('NOT_FOUND', { resource: 'membership' });
    const roleCode = current.role.code;
    if (!isRoleCode(roleCode)) throw new DomainError('NOT_FOUND', { resource: 'membership' });
    await this.assertCanGrant(user, organizationId, roleCode);
    if (patch.status && patch.status !== current.status) {
      const check = checkTransition(MEMBERSHIP_TRANSITIONS, current.status, patch.status);
      if (!check.ok)
        throw new DomainError('INVALID_TRANSITION', {
          from: current.status,
          to: patch.status,
          allowed: check.allowed,
        });
    }
    if (patch.validTo && current.validFrom && patch.validTo < current.validFrom.toISOString().slice(0, 10)) {
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'validTo', code: 'before_valid_from' }],
      });
    }
    const updated = await this.db.tx(async (tx) => {
      const { count } = await tx.organizationMembership.updateMany({
        where: { id: membershipId, version },
        data: {
          status: patch.status,
          validTo:
            patch.validTo === undefined
              ? undefined
              : patch.validTo === null
                ? null
                : new Date(`${patch.validTo}T00:00:00Z`),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict(current.version);
      if (current.userId)
        await tx.user.update({
          where: { id: current.userId },
          data: { permissionsVersion: { increment: 1 } },
        });
      await this.audit.record(tx, {
        action: 'organization.member_updated',
        entityType: 'OrganizationMembership',
        entityId: membershipId,
        organizationId,
        before: { status: current.status, validTo: dateOnly(current.validTo) },
        after: {
          status: patch.status ?? current.status,
          validTo: patch.validTo === undefined ? dateOnly(current.validTo) : patch.validTo,
        },
      });
      return tx.organizationMembership.findUniqueOrThrow({
        where: { id: membershipId },
        include: MEMBER_INCLUDE,
      });
    });
    return toDto(updated);
  }
}
