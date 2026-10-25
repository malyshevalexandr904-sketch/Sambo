'use client';
// Заявки на проведение турнира (docs/RATED_ONLY.md, 2): организация видит свои, администратор платформы — все и
// рассматривает их. По умолчанию администратору показываются ожидающие решения.
import {
  COMPETITION_REQUEST_STATUSES,
  type CompetitionRequestDto,
  type CompetitionRequestStatus,
  type Page,
} from '@sde/contracts';
import { Button, Card, EmptyState, PageHeader } from '@sde/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { formatDates } from '@/features/competitions/shared';
import { Link } from '@/i18n/navigation';
import { hasAnywhere, platformHas } from '@/lib/access';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { RequestStatusBadge } from './shared';

type Filter = CompetitionRequestStatus | 'ALL';

export function CompetitionRequestsList() {
  const t = useTranslations('competitionRequests');
  const locale = useLocale();
  const { data: me } = useMe();
  const reviewer = platformHas(me, 'competition.create_rated');
  const [filter, setFilter] = useState<Filter>(reviewer ? 'SUBMITTED' : 'ALL');
  const status = filter === 'ALL' ? undefined : filter;
  const list = useInfiniteQuery({
    queryKey: ['competition-requests', { status }],
    queryFn: ({ pageParam }) =>
      api<Page<CompetitionRequestDto>>('/competition-requests', {
        query: { status, cursor: pageParam, limit: 25 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filters: Filter[] = ['ALL', ...COMPETITION_REQUEST_STATUSES];
  return (
    <>
      <PageHeader
        title={t('title')}
        description={reviewer ? t('hintReviewer') : t('hint')}
        actions={
          hasAnywhere(me, 'competition.request') ? (
            <Link
              href="/competition-requests/new"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
            >
              {t('new')}
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('title')}>
        {filters.map((f) => (
          <Button
            key={f}
            role="tab"
            aria-selected={filter === f}
            variant={filter === f ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? t('all') : t(`statuses.${f}`)}
          </Button>
        ))}
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')}>{reviewer ? t('emptyReviewer') : t('emptyHint')}</EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Card className="h-full">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/competition-requests/${r.id}`}
                        className="text-lg font-semibold text-blue-800 hover:underline"
                      >
                        {r.name}
                      </Link>
                      <RequestStatusBadge status={r.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDates(r.startDate, r.endDate, locale)} · {r.organization.shortName}
                      {r.venue ? ` · ${r.venue.city ?? r.venue.name}` : ''}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
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
