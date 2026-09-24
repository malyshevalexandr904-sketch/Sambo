'use client';
import type { DataEnvelope, Organization } from '@sde/contracts';
import { Alert, Card, CardTitle, PageHeader } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';

function OrganizationRow({ id, roles }: { id: string; roles: string[] }) {
  const t = useTranslations();
  const org = useQuery({
    queryKey: qk.organization(id),
    queryFn: async () => (await api<DataEnvelope<Organization>>(`/organizations/${id}`)).data,
  });
  return (
    <li className="flex flex-col gap-1 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <Link href={`/admin/organizations/${id}`} className="font-medium text-blue-700 hover:underline">
        {org.data?.name ?? '…'}
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {roles.map((r) => t(`roles.${r}`)).join(', ')}
        {org.data ? <StatusBadge status={org.data.status} /> : null}
      </div>
    </li>
  );
}

export function Dashboard() {
  const t = useTranslations();
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: me.displayName })}
      />
      {me.grants.platform.length > 0 && !me.totpEnabled ? (
        <Alert tone="warning" className="mb-6">
          {t('dashboard.totpWarning')}{' '}
          <Link href="/account" className="font-medium underline">
            {t('nav.account')}
          </Link>
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>{t('dashboard.myOrganizations')}</CardTitle>
          {me.grants.organizations.length === 0 ? (
            <p className="text-sm text-slate-600">{t('dashboard.noOrganizations')}</p>
          ) : (
            <ul>
              {me.grants.organizations.map((o) => (
                <OrganizationRow key={o.organizationId} id={o.organizationId} roles={o.roles} />
              ))}
            </ul>
          )}
          <Link
            href="/admin/organizations/new"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50"
          >
            {t('dashboard.createOrganization')}
          </Link>
        </Card>
        {me.grants.platform.length > 0 ? (
          <Card>
            <CardTitle>{t('dashboard.platformRoles')}</CardTitle>
            <p className="text-sm">{me.grants.platform.map((r) => t(`roles.${r}`)).join(', ')}</p>
          </Card>
        ) : null}
      </div>
      <p className="mt-8 text-sm text-slate-500">{t('dashboard.nextPhases')}</p>
    </>
  );
}
