'use client';
// Организации: список, регистрация, карточка, статус (API.md, 3.4).
import {
  type DataEnvelope,
  type Organization,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  type OrganizationSummary,
  type Page,
} from '@sde/contracts';
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@sde/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { QueryState, ReasonAction, StatusBadge } from '@/components/common';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk, useCountries, useRegions } from '@/lib/queries';
import { MembersPanel } from './members';
import { OrganizationForm } from './organization-form';

export function OrganizationsList() {
  const t = useTranslations();
  const [draft, setDraft] = useState({ q: '', type: '', status: '' });
  const [filters, setFilters] = useState(draft);
  const query = useInfiniteQuery({
    queryKey: qk.organizations(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<OrganizationSummary>>('/organizations', {
        query: { ...filters, cursor: pageParam, limit: 25 },
      }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader
        title={t('organizations.title')}
        actions={
          <Link
            href="/admin/organizations/new"
            className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
          >
            {t('organizations.create')}
          </Link>
        }
      />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <label className="sr-only" htmlFor="org-q">
          {t('common.search')}
        </label>
        <Input
          id="org-q"
          placeholder={t('organizations.searchPlaceholder')}
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <Select
          aria-label={t('organizations.type')}
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value })}
        >
          <option value="">
            {t('organizations.type')}: {t('common.all')}
          </option>
          {ORGANIZATION_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`orgTypes.${x}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('common.status')}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">
            {t('common.status')}: {t('common.all')}
          </option>
          {ORGANIZATION_STATUSES.map((x) => (
            <option key={x} value={x}>
              {t(`statuses.${x}`)}
            </option>
          ))}
        </Select>
        <Button type="submit">{t('common.apply')}</Button>
      </form>
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('organizations.name')}</Th>
                    <Th>{t('organizations.type')}</Th>
                    <Th>{t('organizations.city')}</Th>
                    <Th>{t('common.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <Td>
                        <Link
                          href={`/admin/organizations/${o.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {o.name}
                        </Link>
                        <div className="text-xs text-slate-500">{o.slug}</div>
                      </Td>
                      <Td>{t(`orgTypes.${o.type}`)}</Td>
                      <Td>{o.city ?? '—'}</Td>
                      <Td>
                        <StatusBadge status={o.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {query.hasNextPage ? (
                <Button
                  variant="secondary"
                  className="mt-4"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </>
  );
}

export function OrganizationCreate() {
  const t = useTranslations('organizations');
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <>
      <PageHeader title={t('createTitle')} description={t('createHint')} />
      <OrganizationForm
        mode="create"
        submitLabel={t('create')}
        onSubmit={async (payload) => {
          const res = await api<DataEnvelope<Organization>>('/organizations', {
            method: 'POST',
            body: payload,
          });
          await queryClient.invalidateQueries({ queryKey: ['organizations'] });
          await queryClient.invalidateQueries({ queryKey: qk.me });
          router.push(`/admin/organizations/${res.data.id}`);
        }}
      />
    </>
  );
}

function Transitions({ org, onChanged }: { org: Organization; onChanged: () => Promise<void> }) {
  const t = useTranslations();
  const targets = org.allowedActions
    .filter((a) => a.startsWith('transition:'))
    .map((a) => a.slice('transition:'.length));
  if (targets.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t('organizations.transitions')}</CardTitle>
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <ReasonAction
            key={to}
            label={t('organizations.transitionTo', { status: t(`statuses.${to}`) })}
            title={t('organizations.transitionTo', { status: t(`statuses.${to}`) })}
            variant={to === 'ACTIVE' ? 'primary' : 'danger'}
            required={to !== 'ACTIVE'}
            onConfirm={async (reason) => {
              await api(`/organizations/${org.id}/transitions`, {
                method: 'POST',
                version: org.version,
                body: reason ? { to, reason } : { to },
              });
              await onChanged();
            }}
          />
        ))}
      </div>
    </Card>
  );
}

/** Данные организации: вышестоящая организация, страна и регион — по справочникам на языке интерфейса. */
function OrganizationFacts({ o, canEdit }: { o: Organization; canEdit: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const countries = useCountries();
  const regions = useRegions(o.countryCode);
  const pick = (name: { ru: string; en: string }): string => (locale === 'en' ? name.en : name.ru);
  const country = countries.data?.find((c) => c.code === o.countryCode);
  const region = o.regionId ? regions.data?.find((r) => r.id === o.regionId) : undefined;
  const rows: [string, ReactNode][] = [
    [t('organizations.shortName'), o.shortName],
    [
      t('organizations.parent'),
      o.parent ? (
        <Link href={`/admin/organizations/${o.parent.id}`} className="text-blue-700 hover:underline">
          {o.parent.name}
        </Link>
      ) : (
        t('organizations.noParent')
      ),
    ],
    [t('organizations.country'), country ? pick(country.name) : o.countryCode],
    [t('organizations.region'), region ? pick(region.name) : '—'],
    [t('organizations.city'), o.city ?? '—'],
    [t('organizations.address'), o.address ?? '—'],
    [t('organizations.contactEmail'), <span className="break-all">{o.contactEmail ?? '—'}</span>],
    [t('organizations.contactPhone'), o.contactPhone ?? '—'],
    [t('organizations.website'), <span className="break-all">{o.website ?? '—'}</span>],
    [t('organizations.inn'), o.legalDetails?.inn ?? (canEdit ? '—' : t('organizations.legalHidden'))],
  ];
  return (
    <Card>
      <CardTitle>{t('organizations.details')}</CardTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function OrganizationDetail({ id }: { id: string }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const org = useQuery({
    queryKey: qk.organization(id),
    queryFn: async () => (await api<DataEnvelope<Organization>>(`/organizations/${id}`)).data,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['organizations'] });
  };
  return (
    <QueryState isPending={org.isPending} error={org.error}>
      {() => {
        const o = org.data as Organization;
        const canEdit = o.allowedActions.includes('organization.update');
        return (
          <>
            <PageHeader
              title={o.name}
              description={`${t(`orgTypes.${o.type}`)} · ${o.slug}`}
              actions={
                <>
                  <StatusBadge status={o.status} />
                  {canEdit ? (
                    <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                      {editing ? t('common.cancel') : t('organizations.edit')}
                    </Button>
                  ) : null}
                </>
              }
            />
            {o.status === 'PENDING_REVIEW' ? (
              <Alert tone="warning" className="mb-6">
                {t('organizations.pendingNotice')}
              </Alert>
            ) : null}
            {saved ? (
              <Alert tone="success" className="mb-6">
                {t('common.saved')}
              </Alert>
            ) : null}
            {editing ? (
              <OrganizationForm
                key={o.version}
                mode="edit"
                initial={o}
                submitLabel={t('common.save')}
                onSubmit={async (payload) => {
                  await api(`/organizations/${o.id}`, { method: 'PATCH', version: o.version, body: payload });
                  await refresh();
                  setEditing(false);
                  setSaved(true);
                }}
              />
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                <OrganizationFacts o={o} canEdit={canEdit} />
                <Transitions org={o} onChanged={refresh} />
                {o.allowedActions.includes('organization.members.view') ? (
                  <MembersPanel
                    organizationId={o.id}
                    canManage={o.allowedActions.includes('organization.members.manage')}
                  />
                ) : null}
              </div>
            )}
          </>
        );
      }}
    </QueryState>
  );
}
