// Разрешение прав с областями и наследованием (PERMISSIONS.md, 1, 5, 6). Чистые функции без NestJS и Prisma.
import {
  type GrantMode,
  type OrganizationStatus,
  PERMISSIONS,
  type PermissionCode,
  type PermissionScope,
  ROLE_PERMISSIONS,
  ROLES,
  type RoleCode,
} from '@sde/contracts';

export interface OrganizationGrant {
  organizationId: string;
  organizationStatus: OrganizationStatus;
  roles: RoleCode[];
}

export interface CompetitionGrant {
  competitionId: string;
  roles: RoleCode[];
}

/** Эффективные права пользователя. Кэшируются по `permissionsVersion` (PERMISSIONS.md, 6). */
export interface EffectiveGrants {
  userId: string;
  permissionsVersion: number;
  /** Платформенные роли действуют только при включённом TOTP (ARCHITECTURE.md, 6). */
  platform: RoleCode[];
  organizations: OrganizationGrant[];
  competitions: CompetitionGrant[];
}

export type ResourceScope =
  | { kind: 'PLATFORM' }
  | {
      kind: 'ORGANIZATION';
      organizationId: string;
      /** Предки организации, включая её саму (OrganizationClosure). */
      ancestorIds: string[];
      /** Ресурс виден любому вошедшему (активная организация). Иначе нет прав → 404. */
      visibleToAll: boolean;
    }
  | {
      kind: 'COMPETITION';
      competitionId: string;
      organizerOrganizationId: string;
      organizerAncestorIds: string[];
      visibleToAll: boolean;
    };

/**
 * Область «нигде»: ресурс без организации (например, спортсмен, покинувший все клубы).
 * Доступен только через платформенные роли, остальным — 404.
 */
export const NOWHERE_SCOPE: ResourceScope = {
  kind: 'ORGANIZATION',
  organizationId: '00000000-0000-0000-0000-000000000000',
  ancestorIds: [],
  visibleToAll: false,
};

export interface GrantDecision {
  allowed: boolean;
  mode: GrantMode | null;
  /** Право получено через платформенную роль. */
  viaPlatform: boolean;
}

/**
 * Права участника неактивной организации: пока организация на проверке, её участники могут
 * исправлять её данные и состав; приостановленная или архивная организация прав не даёт,
 * кроме просмотра состава. Наследования на дочерние и на турниры нет.
 */
const RESTRICTED_ORG_PERMISSIONS: Record<OrganizationStatus, ReadonlySet<PermissionCode>> = {
  ACTIVE: new Set(),
  PENDING_REVIEW: new Set([
    'organization.update',
    'organization.members.view',
    'organization.members.manage',
  ]),
  SUSPENDED: new Set(['organization.members.view']),
  ARCHIVED: new Set(['organization.members.view']),
};

const MODE_RANK: Record<GrantMode, number> = { DIRECT: 4, INHERITED: 3, LIMITED: 2, POLICY: 1 };

function better(a: GrantMode | null, b: GrantMode | null | undefined): GrantMode | null {
  if (!b) return a;
  if (!a) return b;
  return MODE_RANK[b] > MODE_RANK[a] ? b : a;
}

function permissionHasScope(permission: PermissionCode, scope: PermissionScope): boolean {
  return (PERMISSIONS[permission].scopes as readonly PermissionScope[]).includes(scope);
}

function orgGrantApplies(
  grant: OrganizationGrant,
  role: RoleCode,
  targetOrgId: string,
  targetAncestors: string[],
): boolean {
  if (grant.organizationId === targetOrgId) return true;
  return (
    ROLES[role].inheritsToDescendants &&
    grant.organizationStatus === 'ACTIVE' &&
    targetAncestors.includes(grant.organizationId)
  );
}

function modeFromOrganizations(
  grants: EffectiveGrants,
  permission: PermissionCode,
  orgId: string,
  ancestors: string[],
): GrantMode | null {
  let mode: GrantMode | null = null;
  for (const g of grants.organizations) {
    const restricted = g.organizationStatus !== 'ACTIVE';
    if (
      restricted &&
      (g.organizationId !== orgId || !RESTRICTED_ORG_PERMISSIONS[g.organizationStatus].has(permission))
    ) {
      continue;
    }
    for (const role of g.roles) {
      const m = ROLE_PERMISSIONS[role][permission];
      if (!m || m === 'INHERITED' || m === 'LIMITED') continue;
      if (orgGrantApplies(g, role, orgId, ancestors)) mode = better(mode, m);
    }
  }
  return mode;
}

function modeFromCompetition(
  grants: EffectiveGrants,
  permission: PermissionCode,
  scope: Extract<ResourceScope, { kind: 'COMPETITION' }>,
): GrantMode | null {
  let mode: GrantMode | null = null;
  for (const g of grants.competitions) {
    if (g.competitionId !== scope.competitionId) continue;
    for (const role of g.roles) mode = better(mode, ROLE_PERMISSIONS[role][permission]);
  }
  // Организационные роли на турнирах своей организации: ▲ у ORGANIZER, ● у FEDERATION_ADMIN (с потомками).
  for (const g of grants.organizations) {
    if (g.organizationStatus !== 'ACTIVE') continue;
    for (const role of g.roles) {
      const m = ROLE_PERMISSIONS[role][permission];
      if (m && orgGrantApplies(g, role, scope.organizerOrganizationId, scope.organizerAncestorIds))
        mode = better(mode, m);
    }
  }
  return mode;
}

export function decide(
  grants: EffectiveGrants,
  permission: PermissionCode,
  scope: ResourceScope,
): GrantDecision {
  for (const role of grants.platform) {
    const m = ROLE_PERMISSIONS[role][permission];
    if (m) return { allowed: true, mode: m, viaPlatform: true };
  }
  if (scope.kind === 'PLATFORM' || !permissionHasScope(permission, scope.kind)) {
    return { allowed: false, mode: null, viaPlatform: false };
  }
  const mode =
    scope.kind === 'ORGANIZATION'
      ? modeFromOrganizations(grants, permission, scope.organizationId, scope.ancestorIds)
      : modeFromCompetition(grants, permission, scope);
  return { allowed: mode !== null, mode, viaPlatform: false };
}

/** Все permissions пользователя в области: для allowedActions и проверки «нельзя выдать роль шире своей». */
export function permissionsInScope(grants: EffectiveGrants, scope: ResourceScope): Set<PermissionCode> {
  const result = new Set<PermissionCode>();
  for (const code of Object.keys(PERMISSIONS) as PermissionCode[]) {
    if (decide(grants, code, scope).allowed) result.add(code);
  }
  return result;
}

/**
 * Где действует право в организациях — для фильтра списков в SQL тем же набором областей (PERMISSIONS.md, 6).
 * `withDescendants` — право наследуется на дочерние организации (ORG_DESCENDANT).
 */
export interface OrganizationReach {
  platform: boolean;
  organizations: { organizationId: string; mode: GrantMode; withDescendants: boolean }[];
}

export function organizationReach(grants: EffectiveGrants, permission: PermissionCode): OrganizationReach {
  const platform = grants.platform.some((role) => ROLE_PERMISSIONS[role][permission] !== undefined);
  const byOrg = new Map<string, { mode: GrantMode; withDescendants: boolean }>();
  for (const g of grants.organizations) {
    const restricted = g.organizationStatus !== 'ACTIVE';
    if (restricted && !RESTRICTED_ORG_PERMISSIONS[g.organizationStatus].has(permission)) continue;
    for (const role of g.roles) {
      const m = ROLE_PERMISSIONS[role][permission];
      if (!m || m === 'INHERITED' || m === 'LIMITED') continue;
      const prev = byOrg.get(g.organizationId);
      byOrg.set(g.organizationId, {
        mode: better(prev?.mode ?? null, m) ?? m,
        withDescendants:
          (prev?.withDescendants ?? false) || (!restricted && ROLES[role].inheritsToDescendants),
      });
    }
  }
  return { platform, organizations: [...byOrg].map(([organizationId, v]) => ({ organizationId, ...v })) };
}

/** Право есть хотя бы в одной области: платформа, организация или турнир. */
export function holdsAnywhere(grants: EffectiveGrants, permission: PermissionCode): boolean {
  const reach = organizationReach(grants, permission);
  if (reach.platform || reach.organizations.length > 0) return true;
  return grants.competitions.some((g) => g.roles.some((r) => ROLE_PERMISSIONS[r][permission] !== undefined));
}

/** Видит ли пользователь ресурс вообще (иначе — 404, а не 403). */
export function canSee(grants: EffectiveGrants, scope: ResourceScope): boolean {
  if (scope.kind === 'PLATFORM') return true;
  if (scope.visibleToAll || grants.platform.length > 0) return true;
  const ancestors = scope.kind === 'ORGANIZATION' ? scope.ancestorIds : scope.organizerAncestorIds;
  if (grants.organizations.some((g) => ancestors.includes(g.organizationId))) return true;
  return (
    scope.kind === 'COMPETITION' && grants.competitions.some((g) => g.competitionId === scope.competitionId)
  );
}

/** Роль можно выдать, только если у выдающего есть все её права в этой области (API.md, 3.4). */
export function missingPermissionsForRole(granted: Set<PermissionCode>, role: RoleCode): PermissionCode[] {
  return (Object.keys(ROLE_PERMISSIONS[role]) as PermissionCode[]).filter((p) => !granted.has(p));
}

/**
 * Права, которые пользователь может передать ролью организации: права в самой организации
 * и права на её турниры (для ролей вроде ORGANIZER и FEDERATION_ADMIN, у которых есть турнирные права).
 */
export function grantablePermissions(
  grants: EffectiveGrants,
  scope: Extract<ResourceScope, { kind: 'ORGANIZATION' }>,
): Set<PermissionCode> {
  const inOrg = permissionsInScope(grants, scope);
  const onCompetitions = permissionsInScope(grants, {
    kind: 'COMPETITION',
    competitionId: '00000000-0000-0000-0000-000000000000',
    organizerOrganizationId: scope.organizationId,
    organizerAncestorIds: scope.ancestorIds,
    visibleToAll: false,
  });
  return new Set([...inOrg, ...onCompetitions]);
}
