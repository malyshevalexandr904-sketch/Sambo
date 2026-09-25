'use client';
import type { DataEnvelope, Organization } from '@sde/contracts';
import { Alert, Card, CardTitle, PageHeader } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { hasAnywhere } from '@/lib/access';
import { qk, useMe, useMyAthletes } from '@/lib/queries';

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

function WorkCard() {
  const t = useTranslations();
  const { data: me } = useMe();
  const mine = useMyAthletes(!!me?.personId);
  const links = [
    { href: '/athletes', label: t('dashboard.links.athletes'), visible: hasAnywhere(me, 'athlete.view') },
    {
      href: '/athletes/new',
      label: t('dashboard.links.newAthlete'),
      visible: hasAnywhere(me, 'athlete.create'),
    },
    {
      href: '/athletes/import',
      label: t('dashboard.links.import'),
      visible: hasAnywhere(me, 'athlete.import'),
    },
    { href: '/children', label: t('dashboard.links.children'), visible: (mine.data?.length ?? 0) > 0 },
    {
      href: '/documents',
      label: t('dashboard.links.documents'),
      visible: hasAnywhere(me, 'document.verify'),
    },
    { href: '/account', label: t('dashboard.links.person'), visible: !me?.personId },
  ].filter((l) => l.visible);
  if (links.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t('dashboard.work')}</CardTitle>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="font-medium text-blue-700 hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
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
        <WorkCard />
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
