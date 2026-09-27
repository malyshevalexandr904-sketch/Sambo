'use client';
// Заявки и участники турнира для персонала (API.md, 5.3): очередь заявок с фильтрами, список участий
// с решениями и переводом между категориями, выгрузка CSV с теми же фильтрами.
import {
  APPLICATION_STATUSES,
  type ApplicationSummary,
  type Competition,
  ENTRY_STATUSES,
  type EntryDto,
  type Page,
} from '@sde/contracts';
import { Button, EmptyState, Field, Input, Select, Table, Td, Th } from '@sde/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { EntryActions } from '@/features/applications/entry-actions';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { useCategories } from './categories';
import { ApplicationStatusBadge, EntryStatusBadge } from './shared';

export function ApplicationsTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('applications');
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const params = { status: status || undefined, q: q.trim() || undefined };
  const list = useInfiniteQuery({
    queryKey: qk.competitionApplications(c.id, params),
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationSummary>>(`/competitions/${c.id}/applications`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="app-status" label={t('status')}>
          <Select id="app-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allStatuses')}</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="app-q" label={t('searchClub')}>
          <Input id="app-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </Field>
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('club')}</Th>
                  <Th>{t('coach')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('athletes')}</Th>
                  <Th>{t('submittedAt')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/applications/${a.id}`} className="font-medium text-blue-700 underline">
                        {a.organization.shortName || a.organization.name}
                      </Link>
                    </Td>
                    <Td>{a.coach?.name ?? '—'}</Td>
                    <Td>
                      <ApplicationStatusBadge status={a.status} />
                    </Td>
                    <Td>
                      {t('countsShort', {
                        total: a.counts.entries,
                        approved: a.counts.approved,
                        pending: a.counts.pending,
                      })}
                    </Td>
                    <Td>{a.submittedAt ? formatDateTime(a.submittedAt, locale) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

export function EntriesTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('applications');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useCategories(c.id);
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const params = {
    categoryId: categoryId || undefined,
    status: status || undefined,
    q: q.trim() || undefined,
  };
  const list = useInfiniteQuery({
    queryKey: qk.competitionEntries(c.id, params),
    queryFn: ({ pageParam }) =>
      api<Page<EntryDto>>(`/competitions/${c.id}/entries`, {
        query: { ...params, cursor: pageParam, limit: 100 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const exportQuery = new URLSearchParams();
  if (categoryId) exportQuery.set('categoryId', categoryId);
  if (status) exportQuery.set('status', status);
  const exportHref = `/api/v1/competitions/${c.id}/entries/export.csv${exportQuery.size ? `?${exportQuery}` : ''}`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="entry-category" label={t('category')}>
          <Select id="entry-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('allCategories')}</option>
            {(categories.data ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {pickName(cat.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="entry-status" label={t('status')}>
          <Select id="entry-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allStatuses')}</option>
            {ENTRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`entryStatuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="entry-q" label={t('searchAthlete')}>
          <Input
            id="entry-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
          />
        </Field>
        {c.allowedActions.includes('registration.export') ? (
          <div className="flex items-end">
            <a
              href={exportHref}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50"
              download
            >
              {t('exportCsv')}
            </a>
          </div>
        ) : null}
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('noEntries')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('athlete')}</Th>
                  <Th>{t('category')}</Th>
                  <Th>{t('club')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <Td>
                      <p className="font-medium">{e.publicName}</p>
                      <p className="text-xs text-slate-500">
                        {formatDate(e.snapshot.birthDate, locale)}
                        {e.snapshot.rankCode ? ` · ${e.snapshot.rankCode}` : ''}
                      </p>
                    </Td>
                    <Td>
                      {pickName(e.category.name, locale)}
                      {e.declaredCategory.id !== e.category.id ? (
                        <p className="text-xs text-slate-500">
                          {t('declaredCategory', { name: pickName(e.declaredCategory.name, locale) })}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <Link href={`/applications/${e.applicationId}`} className="text-blue-700 underline">
                        {e.organization.shortName || e.organization.name}
                      </Link>
                    </Td>
                    <Td>
                      <EntryStatusBadge status={e.status} />
                      {e.decisionReason ? (
                        <p className="mt-1 text-xs text-slate-600">{e.decisionReason}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <EntryActions entry={e} categories={categories.data} onChanged={refresh} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
