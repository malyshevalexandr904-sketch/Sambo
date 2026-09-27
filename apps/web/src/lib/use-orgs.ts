'use client';
// Организации, где у пользователя есть право: для выбора клуба, организатора или владельца справочной записи.
// Раньше список брался из первых 100 организаций — организация за этой границей не находилась. Теперь свои
// организации загружаются по идентификаторам из прав (/me), а платформенная роль ищет по названию на сервере.
import type {
  DataEnvelope,
  Organization,
  OrganizationSummary,
  OrganizationType,
  Page,
  PermissionCode,
} from '@sde/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { organizationsWith, platformHas } from './access';
import { api } from './api';
import { qk, useMe } from './queries';

/** Сколько найденных организаций показывать платформенной роли: уточняйте поиском. */
export const ORGANIZATION_SEARCH_LIMIT = 50;

export function useOrganizationsWith(
  permission: PermissionCode,
  types?: readonly OrganizationType[],
  /** Поиск по названию (для платформенной роли, которой доступны все организации). */
  q = '',
): { data: OrganizationSummary[]; isPending: boolean; searchable: boolean } {
  const { data: me } = useMe();
  const all = platformHas(me, permission);
  const own = all ? [] : organizationsWith(me, permission);
  const search = q.trim();
  const found = useQuery({
    queryKey: qk.organizations({ purpose: 'pick', status: 'ACTIVE', q: search }),
    queryFn: () =>
      api<Page<OrganizationSummary>>('/organizations', {
        query: { status: 'ACTIVE', q: search || undefined, limit: ORGANIZATION_SEARCH_LIMIT },
      }),
    enabled: !!me && all,
  });
  const mine = useQueries({
    queries: own.map((id) => ({
      queryKey: qk.organization(id),
      queryFn: async () => (await api<DataEnvelope<Organization>>(`/organizations/${id}`)).data,
      staleTime: 60_000,
    })),
  });
  const rows: OrganizationSummary[] = all
    ? (found.data?.data ?? [])
    : mine.flatMap((r) => (r.data && r.data.status === 'ACTIVE' ? [r.data] : []));
  const data = rows
    .filter((o) => !types || types.includes(o.type))
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
  return {
    data,
    isPending: !me || (all ? found.isPending : mine.some((r) => r.isPending)),
    searchable: all,
  };
}
