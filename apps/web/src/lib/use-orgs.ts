'use client';
// Организации, где у пользователя есть право: для выбора клуба или владельца справочной записи.
import type { OrganizationSummary, OrganizationType, Page, PermissionCode } from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { organizationsWith, platformHas } from './access';
import { api } from './api';
import { qk, useMe } from './queries';

/** Платформенной роли — все активные организации (с учётом типов), иначе — те, где право выдано. */
export function useOrganizationsWith(
  permission: PermissionCode,
  types?: readonly OrganizationType[],
): { data: OrganizationSummary[]; isPending: boolean } {
  const { data: me } = useMe();
  const orgs = useQuery({
    queryKey: qk.organizations({ purpose: 'pick', status: 'ACTIVE' }),
    queryFn: () =>
      api<Page<OrganizationSummary>>('/organizations', { query: { status: 'ACTIVE', limit: 100 } }),
    enabled: !!me,
  });
  const allowed = new Set(organizationsWith(me, permission));
  const all = platformHas(me, permission);
  const data = (orgs.data?.data ?? []).filter(
    (o) => (!types || types.includes(o.type)) && (all || allowed.has(o.id)),
  );
  return { data, isPending: orgs.isPending };
}
