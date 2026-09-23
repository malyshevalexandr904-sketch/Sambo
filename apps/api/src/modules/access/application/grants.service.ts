import { Injectable, Logger } from '@nestjs/common';
import { type OrganizationStatus, ROLES, type RoleCode, isRoleCode } from '@sde/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import type { EffectiveGrants } from '../domain/grants';

const CACHE_TTL_SECONDS = 60;

/** Загрузка эффективных прав: платформенные роли, членства в организациях и турнирах (PERMISSIONS.md, 6). */
@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async forUser(userId: string, permissionsVersion: number): Promise<EffectiveGrants> {
    const key = `grants:${userId}:${permissionsVersion}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as EffectiveGrants;
    } catch (e) {
      this.logger.warn({ err: e }, 'Grants cache unavailable, loading from database');
    }
    const grants = await this.load(userId, permissionsVersion);
    this.redis.set(key, JSON.stringify(grants), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
    return grants;
  }

  private async load(userId: string, permissionsVersion: number): Promise<EffectiveGrants> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [user, platform, orgMemberships, compMemberships] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, status: true } }),
      this.db.platformRoleAssignment.findMany({ where: { userId, revokedAt: null }, select: { role: { select: { code: true } } } }),
      this.db.organizationMembership.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          OR: [{ validTo: null }, { validTo: { gte: today } }],
          organization: { deletedAt: null },
        },
        select: { organizationId: true, role: { select: { code: true } }, organization: { select: { status: true } } },
      }),
      this.db.competitionMembership.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { competitionId: true, role: { select: { code: true } } },
      }),
    ]);
    const empty: EffectiveGrants = { userId, permissionsVersion, platform: [], organizations: [], competitions: [] };
    if (!user || user.status !== 'ACTIVE') return empty;

    const platformRoles = platform
      .map((p) => p.role.code)
      .filter(isRoleCode)
      .filter((r) => ROLES[r].scope === 'PLATFORM' && (!ROLES[r].requiresTotp || user.totpEnabledAt !== null));

    const orgs = new Map<string, { organizationStatus: OrganizationStatus; roles: RoleCode[] }>();
    for (const m of orgMemberships) {
      if (!isRoleCode(m.role.code) || ROLES[m.role.code].scope !== 'ORGANIZATION') continue;
      const entry = orgs.get(m.organizationId) ?? { organizationStatus: m.organization.status, roles: [] };
      entry.roles.push(m.role.code);
      orgs.set(m.organizationId, entry);
    }
    const comps = new Map<string, RoleCode[]>();
    for (const m of compMemberships) {
      if (!isRoleCode(m.role.code) || ROLES[m.role.code].scope !== 'COMPETITION') continue;
      comps.set(m.competitionId, [...(comps.get(m.competitionId) ?? []), m.role.code]);
    }
    return {
      userId,
      permissionsVersion,
      platform: platformRoles,
      organizations: [...orgs].map(([organizationId, v]) => ({ organizationId, ...v })),
      competitions: [...comps].map(([competitionId, roles]) => ({ competitionId, roles })),
    };
  }
}
