'use client';
// Организации пользователя: в личном кабинете и во вкладке «Организации» настроек.
import type { DataEnvelope, Me, Organization } from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/common';
import { Icon } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { ProfileEmpty } from './profile-view';

function OrganizationItem({ id, roles }: { id: string; roles: string[] }) {
  const t = useTranslations();
  const org = useQuery({
    queryKey: qk.organization(id),
    queryFn: async () => (await api<DataEnvelope<Organization>>(`/organizations/${id}`)).data,
  });
  return (
    <li>
      <Link
        href={`/admin/organizations/${id}`}
        className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-blue-200 hover:bg-slate-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon name="building" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-900">{org.data?.name ?? '…'}</span>
          <span className="block text-xs text-slate-600">{roles.map((r) => t(`roles.${r}`)).join(', ')}</span>
        </span>
        {org.data ? <StatusBadge status={org.data.status} /> : null}
      </Link>
    </li>
  );
}

export function OrganizationsList({ me }: { me: Me }) {
  const t = useTranslations('profile');
  if (me.grants.organizations.length === 0)
    return <ProfileEmpty icon="building" text={t('noOrganizations')} />;
  return (
    <ul className="space-y-2">
      {me.grants.organizations.map((o) => (
        <OrganizationItem key={o.organizationId} id={o.organizationId} roles={o.roles} />
      ))}
    </ul>
  );
}
