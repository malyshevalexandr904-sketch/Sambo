'use client';
// Мои заявки (API.md, 5.3: GET /me/applications): заявки клубов, от имени которых пользователь подаёт заявки,
// по всем турнирам. Из карточки турнира открывается с фильтром по турниру.
import { APPLICATION_STATUSES, type ApplicationSummary, type Page } from '@sde/contracts';
import { Button, EmptyState, Field, PageHeader, Select, Table, Td, Th } from '@sde/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { ApplicationStatusBadge, formatDates } from '@/features/competitions/shared';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';

export function MyApplications() {
  const t = useTranslations('applications');
  const locale = useLocale();
  const search = useSearchParams();
  const competitionId = search.get('competitionId') ?? undefined;
  const [status, setStatus] = useState('');
  const params = { competitionId, status: status || undefined };
  const list = useInfiniteQuery({
    queryKey: qk.myApplications(params),
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationSummary>>('/me/applications', {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('myTitle')} description={t('myHint')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field id="my-app-status" label={t('status')} className="min-w-56">
          <Select id="my-app-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allStatuses')}</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        {competitionId ? (
          <Link href="/applications" className="inline-flex min-h-11 items-center text-blue-700 underline">
            {t('allCompetitions')}
          </Link>
        ) : null}
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('myEmpty')}>
              <Link href="/competitions" className="text-blue-700 underline">
                {t('findCompetitions')}
              </Link>
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('competition')}</Th>
                  <Th>{t('club')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('athletes')}</Th>
                  <Th>{t('updatedAt')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/applications/${a.id}`} className="font-medium text-blue-700 underline">
                        {a.competition.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {formatDates(a.competition.startDate, a.competition.startDate, locale)}
                      </p>
                    </Td>
                    <Td>{a.organization.shortName || a.organization.name}</Td>
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
                    <Td>{formatDateTime(a.updatedAt, locale)}</Td>
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
          className="mt-4"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </>
  );
}
