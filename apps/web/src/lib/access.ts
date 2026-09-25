// Права текущего пользователя для интерфейса (PERMISSIONS.md, 6): только скрытие недоступного.
// Решение всегда принимает сервер; для ресурсов UI опирается на allowedActions.
import { type Me, type PermissionCode, ROLE_PERMISSIONS, type RoleCode } from '@sde/contracts';

const has = (roles: readonly RoleCode[], permission: PermissionCode): boolean =>
  roles.some((r) => ROLE_PERMISSIONS[r][permission] !== undefined);

/** Платформенные роли действуют только с включённым TOTP. */
export function platformHas(me: Me | undefined, permission: PermissionCode): boolean {
  return !!me?.totpEnabled && has(me.grants.platform, permission);
}

/** Организации, где у пользователя есть право (прямое или по политике). */
export function organizationsWith(me: Me | undefined, permission: PermissionCode): string[] {
  return (me?.grants.organizations ?? [])
    .filter((g) => has(g.roles, permission))
    .map((g) => g.organizationId);
}

/** Право есть хоть где-то: платформа, организация или турнир. */
export function hasAnywhere(me: Me | undefined, permission: PermissionCode): boolean {
  if (!me) return false;
  return (
    platformHas(me, permission) ||
    organizationsWith(me, permission).length > 0 ||
    me.grants.competitions.some((g) => has(g.roles, permission))
  );
}

export function hasOrgRole(me: Me | undefined, organizationId: string, role: RoleCode): boolean {
  return !!me?.grants.organizations.some(
    (g) => g.organizationId === organizationId && g.roles.includes(role),
  );
}
