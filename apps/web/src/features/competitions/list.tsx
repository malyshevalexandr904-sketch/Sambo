'use client';
// Турниры (API.md, 5.1): служебные — где пользователь организатор или персонал (включая черновики);
// открытые — опубликованные турниры с идущей регистрацией, куда клуб может подать заявку.
import { type CompetitionSummary, type Page } from '@sde/contracts';
import { Button, Card, EmptyState, PageHeader } from '@sde/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { hasAnywhere } from '@/lib/access';
import { api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { CompetitionStatusBadge, formatDates, formatInZone } from './shared';

type Scope = 'mine' | 'open' | 'all';

export function CompetitionsList() {
  const t = useTranslations('competitions');
  const { data: me } = useMe();
  const staff = hasAnywhere(me, 'competition.view') || hasAnywhere(me, 'competition.create');
  const [scope, setScope] = useState<Scope>(staff ? 'mine' : 'open');
  const params = {
    mine: scope === 'mine' ? 'true' : undefined,
    registrationOpen: scope === 'open' ? 'true' : undefined,
  };
  const list = useInfiniteQuery({
    queryKey: qk.competitions(params),
    queryFn: ({ pageParam }) =>
      api<Page<CompetitionSummary>>('/competitions', { query: { ...params, cursor: pageParam, limit: 25 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const scopes: Scope[] = staff ? ['mine', 'open', 'all'] : ['open', 'all'];
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('hint')}
        actions={
          hasAnywhere(me, 'competition.create') ? (
            <Link
              href="/competitions/new"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
            >
              {t('create')}
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('title')}>
        {scopes.map((s) => (
          <Button
            key={s}
            role="tab"
            aria-selected={scope === s}
            variant={scope === s ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setScope(s)}
          >
            {t(`scopes.${s}`)}
          </Button>
        ))}
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')}>{t(`emptyHint.${scope}`)}</EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((c) => (
                <li key={c.id}>
                  <CompetitionCard competition={c} />
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

function CompetitionCard({ competition: c }: { competition: CompetitionSummary }) {
  const t = useTranslations('competitions');
  const locale = useLocale();
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/competitions/${c.id}`} className="text-lg font-semibold text-blue-800 hover:underline">
          {c.name}
        </Link>
        <CompetitionStatusBadge status={c.status} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {formatDates(c.startDate, c.endDate, locale)} · {c.organizer.shortName}
        {c.venue ? ` · ${c.venue.city ?? c.venue.name}` : ''}
      </p>
      <p className="mt-1 text-sm text-slate-600">{t(`levels.${c.level}`)}</p>
      {c.registrationOpenNow ? (
        <p className="mt-2 text-sm font-medium text-green-800">
          {t('registrationUntil', { date: formatInZone(c.registrationEndsAt, c.timezone, locale) })}
        </p>
      ) : null}
    </Card>
  );
}
