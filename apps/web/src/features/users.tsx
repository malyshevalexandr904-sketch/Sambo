'use client';
// Администрирование пользователей (API.md, 3.3).
import {
  type AdminUser,
  type DataEnvelope,
  type Page,
  PLATFORM_ASSIGNABLE_ROLES,
  ROLE_CODES,
  USER_STATUSES,
} from '@sde/contracts';
import {
  Alert,
  Badge,
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
import { useState } from 'react';
import { hasPlatformPermission } from '@/components/app-shell';
import { QueryState, ReasonAction, StatusBadge } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk, useMe } from '@/lib/queries';

export function UsersList() {
  const t = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState({ q: '', status: '', role: '' });
  const [filters, setFilters] = useState(draft);
  const query = useInfiniteQuery({
    queryKey: qk.users(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AdminUser>>('/admin/users', { query: { ...filters, cursor: pageParam, limit: 25 } }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('users.title')} />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <label className="sr-only" htmlFor="q">
          {t('common.search')}
        </label>
        <Input
          id="q"
          placeholder={t('users.searchPlaceholder')}
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <Select
          aria-label={t('common.status')}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">
            {t('common.status')}: {t('common.all')}
          </option>
          {USER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('users.role')}
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
        >
          <option value="">
            {t('users.role')}: {t('common.all')}
          </option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
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
                    <Th>{t('users.name')}</Th>
                    <Th>{t('users.email')}</Th>
                    <Th>{t('common.status')}</Th>
                    <Th>{t('users.platformRoles')}</Th>
                    <Th>{t('users.totp')}</Th>
                    <Th>{t('users.lastLogin')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <Td>
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {u.displayName}
                        </Link>
                      </Td>
                      <Td className="break-all">{u.email}</Td>
                      <Td>
                        <StatusBadge status={u.status} />
                      </Td>
                      <Td>{u.platformRoles.map((r) => t(`roles.${r}`)).join(', ') || '—'}</Td>
                      <Td>{u.totpEnabled ? t('common.yes') : t('common.no')}</Td>
                      <Td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : t('users.never')}</Td>
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

function PlatformRoles({ user, canManage }: { user: AdminUser; canManage: boolean }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  const [role, setRole] = useState<string>(PLATFORM_ASSIGNABLE_ROLES[1]);
  return (
    <Card>
      <CardTitle>{t('users.platformRoles')}</CardTitle>
      <ul className="mb-4 space-y-2">
        {user.platformRoles.length === 0 ? <li className="text-sm text-slate-600">—</li> : null}
        {user.platformRoles.map((r) => (
          <li key={r} className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone="info">{t(`roles.${r}`)}</Badge>
            {canManage ? (
              <ReasonAction
                label={t('users.revokeRole')}
                title={`${t('users.revokeRole')}: ${t(`roles.${r}`)}`}
                variant="danger"
                onConfirm={async (reason) => {
                  await api(`/admin/users/${user.id}/platform-roles/${r}`, {
                    method: 'DELETE',
                    body: { reason },
                  });
                  await refresh();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">{t('users.grantHint')}</p>
          <Select
            aria-label={t('users.role')}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="max-w-xs"
          >
            {PLATFORM_ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
          <ReasonAction
            label={t('users.grantRole')}
            title={t('users.grantRole')}
            onConfirm={async (reason) => {
              await api(`/admin/users/${user.id}/platform-roles`, {
                method: 'POST',
                body: { roleCode: role, reason },
              });
              await refresh();
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}

export function UserDetail({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const user = useQuery({
    queryKey: qk.user(id),
    queryFn: async () => (await api<DataEnvelope<AdminUser>>(`/admin/users/${id}`)).data,
  });
  const canManage = hasPlatformPermission(me, 'user.manage');
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  return (
    <QueryState isPending={user.isPending} error={user.error}>
      {() => {
        const u = user.data as AdminUser;
        return (
          <>
            <PageHeader
              title={u.displayName}
              description={u.email ?? undefined}
              actions={<StatusBadge status={u.status} />}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardTitle>{t('common.details')}</CardTitle>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-500">{t('common.createdAt')}</dt>
                  <dd>{formatDateTime(u.createdAt, locale)}</dd>
                  <dt className="text-slate-500">{t('users.lastLogin')}</dt>
                  <dd>{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : t('users.never')}</dd>
                  <dt className="text-slate-500">{t('users.totp')}</dt>
                  <dd>{u.totpEnabled ? t('common.yes') : t('common.no')}</dd>
                </dl>
                {canManage && me?.id !== u.id ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    {u.status === 'BLOCKED' ? (
                      <ReasonAction
                        label={t('users.unblock')}
                        title={t('users.unblockTitle')}
                        onConfirm={async (reason) => {
                          await api(`/admin/users/${u.id}/unblock`, { method: 'POST', body: { reason } });
                          await refresh();
                        }}
                      />
                    ) : (
                      <ReasonAction
                        label={t('users.block')}
                        title={t('users.blockTitle')}
                        description={t('users.blockBody')}
                        variant="danger"
                        onConfirm={async (reason) => {
                          await api(`/admin/users/${u.id}/block`, { method: 'POST', body: { reason } });
                          await refresh();
                        }}
                      />
                    )}
                  </div>
                ) : null}
              </Card>
              <PlatformRoles user={u} canManage={hasPlatformPermission(me, 'role.manage')} />
              <Card className="xl:col-span-2">
                <CardTitle>{t('users.memberships')}</CardTitle>
                {u.organizations.length === 0 ? (
                  <p className="text-sm text-slate-600">—</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {u.organizations.map((m) => (
                      <li key={`${m.organizationId}-${m.role}`} className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/organizations/${m.organizationId}`}
                          className="text-blue-700 hover:underline"
                        >
                          {m.organizationName}
                        </Link>
                        <span className="text-slate-600">{t(`roles.${m.role}`)}</span>
                        <StatusBadge status={m.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            {u.status === 'BLOCKED' ? (
              <Alert tone="warning" className="mt-6">
                {t('statuses.BLOCKED')}
              </Alert>
            ) : null}
          </>
        );
      }}
    </QueryState>
  );
}
