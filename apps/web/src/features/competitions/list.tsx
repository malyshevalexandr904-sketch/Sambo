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
import { hasAnywhere, platformHas } from '@/lib/access';
import { api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { MyHostingRequests } from '@/features/competition-requests/drafts';
import { HostingProcessButton } from '@/features/competition-requests/hosting-info';
import { CompetitionTypeBadge } from './rating-card';
import { CompetitionStatusBadge, formatDates, formatInZone } from './shared';

type Scope = 'mine' | 'open' | 'all';

export function CompetitionsList() {
  const t = useTranslations('competitions');
  const { data: me } = useMe();
  const canCreate = platformHas(me, 'competition.create_rated');
  const canRequest = hasAnywhere(me, 'competition.request');
  // Призыв подать заявку — только в роли «Руководитель организации» (описание процесса, 02.11.2026, п. 1).
  const showHostingCta = canRequest && me?.activeRole === 'ORGANIZATION_HEAD';
  const staff = hasAnywhere(me, 'competition.view') || canCreate || canRequest;
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
          // Турнир создаёт только платформа; организация подаёт заявку на проведение (docs/RATED_ONLY.md).
          canCreate ? (
            <Link
              href="/competitions/new"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
            >
              {t('create')}
            </Link>
          ) : null
        }
      />
      {showHostingCta ? <HostingCta /> : null}
      {canRequest && !canCreate ? <MyHostingRequests /> : null}
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
        <span className="flex flex-wrap justify-end gap-1">
          <CompetitionTypeBadge competition={c} />
          <CompetitionStatusBadge status={c.status} />
        </span>
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

/**
 * Заметный призыв организации провести рейтинговый турнир у себя: кнопка заявки и «?» с описанием процесса.
 * Фон — сплошной светло-синий blue-50 в тонах платформы (правки 05.11.2026: без градиента, чтобы блок не выделялся);
 * тёмная тема переворачивает его в тёмно-синюю подложку.
 */
function HostingCta() {
  const t = useTranslations('competitions');
  return (
    <section
      aria-labelledby="hosting-cta-title"
      className="mb-6 overflow-hidden rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="hosting-cta-title" className="text-lg font-semibold text-slate-900 sm:text-xl">
            {t('hostingCtaTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{t('hostingCtaText')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/competition-requests/new"
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-blue-700 px-5 py-2 text-center text-base font-semibold text-white shadow-md ring-2 ring-blue-700/20 transition hover:bg-blue-800 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            {t('requestCreate')}
          </Link>
          <HostingProcessButton />
        </div>
      </div>
    </section>
  );
}
