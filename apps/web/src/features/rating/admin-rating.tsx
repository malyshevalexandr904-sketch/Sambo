'use client';
// Раздел «Рейтинг» кабинета администратора платформы (docs/RATING_ARCHITECTURE.md, 8; ТЗ 46, 65; фаза 14): сводка,
// поиск спортсмена, журнал расчётов и досчёт турнира. Права проверяет сервер; здесь — только видимость действий.
import type {
  DataEnvelope,
  Page,
  RatingAthleteHit,
  RatingCalculationEntry,
  RatingCalculationStatus,
  RatingDashboard,
  RatingRecalculationReport,
} from '@sde/contracts';
import { RATING_CALCULATION_STATUSES } from '@sde/contracts';
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
import { QueryState, ReasonAction } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk, useMe } from '@/lib/queries';

const STATUS_TONE: Record<RatingCalculationStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
  SUPERSEDED: 'info',
};

export function CalculationStatus({ status }: { status: RatingCalculationStatus }) {
  const t = useTranslations('ratingAdmin.calculationStatuses');
  return <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge>;
}

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return (
    <span
      className={`font-semibold tabular-nums ${value > 0 ? 'text-green-800' : value < 0 ? 'text-red-800' : ''}`}
    >
      {value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0'}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'warning' | 'danger';
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-sm text-slate-600">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-800' : tone === 'warning' ? 'text-amber-800' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

function Summary() {
  const t = useTranslations('ratingAdmin');
  const locale = useLocale();
  const dash = useQuery({
    queryKey: qk.ratingDashboard,
    queryFn: async () => (await api<DataEnvelope<RatingDashboard>>('/admin/rating/dashboard')).data,
  });
  return (
    <QueryState isPending={dash.isPending} error={dash.error}>
      {() => {
        const d = dash.data as RatingDashboard;
        return (
          <Card>
            <CardTitle>{t('summary')}</CardTitle>
            <p className="mb-3 text-sm text-slate-600">
              {t('version', { version: d.calculationVersion ?? '—' })}
              {d.lastCalculatedAt
                ? ` · ${t('lastCalculated', { at: formatDateTime(d.lastCalculatedAt, locale) })}`
                : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t('athletes')} value={d.athletes.total} />
              <Stat label={t('frozen')} value={d.athletes.frozen + d.athletes.suspended} tone="warning" />
              <Stat label={t('ratedCompetitions')} value={d.ratedCompetitions} />
              <Stat label={t('completed')} value={d.calculations.completed} />
              <Stat label={t('pending')} value={d.calculations.pending} tone="warning" />
              <Stat label={t('failed')} value={d.calculations.failed} tone="danger" />
            </div>
            {d.recentCorrections.length > 0 ? (
              <>
                <h3 className="mt-4 font-medium">{t('recentCorrections')}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {d.recentCorrections.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/admin/rating/athletes/${c.athleteId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {c.athleteName}
                      </Link>{' '}
                      {c.ratingBefore} → {c.ratingAfter} (<Delta value={c.delta} />) ·{' '}
                      {t(`correctionKinds.${c.kind}`)} · {formatDateTime(c.createdAt, locale)}
                      {c.reason ? <span className="text-slate-600"> · {c.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        );
      }}
    </QueryState>
  );
}

function AthleteSearch() {
  const t = useTranslations('ratingAdmin');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const hits = useQuery({
    queryKey: qk.ratingAthletes(q),
    enabled: q.length >= 2,
    queryFn: async () =>
      (await api<DataEnvelope<RatingAthleteHit[]>>('/admin/rating/athletes', { query: { q } })).data,
  });
  return (
    <Card>
      <CardTitle>{t('findAthlete')}</CardTitle>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <Input
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={draft.trim().length < 2}>
          {tc('search')}
        </Button>
      </form>
      {q.length >= 2 ? (
        <div className="mt-3">
          <QueryState isPending={hits.isPending} error={hits.error}>
            {() =>
              (hits.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">{tc('noData')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {(hits.data ?? []).map((h) => (
                    <li key={h.athleteId} className="flex items-center justify-between gap-3 py-2">
                      <Link
                        href={`/admin/rating/athletes/${h.athleteId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {h.name}, {h.birthYear}
                      </Link>
                      <span className="tabular-nums">
                        {h.rating ?? t('noRating')}
                        {h.status && h.status !== 'ACTIVE' ? (
                          <Badge tone="warning" className="ml-2">
                            {t(`ratingStatuses.${h.status}`)}
                          </Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </div>
      ) : null}
    </Card>
  );
}

/** Журнал расчётов; у строки ожидающего или упавшего расчёта — досчёт его турнира. */
export function CalculationJournal({ athleteId }: { athleteId?: string }) {
  const t = useTranslations('ratingAdmin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canRecalculate = hasPlatformPermission(me, 'competition.recalculate_rating');
  const [status, setStatus] = useState<RatingCalculationStatus | ''>('');
  const [report, setReport] = useState<RatingRecalculationReport | null>(null);
  const filters = { status: status || undefined, athleteId };
  const query = useInfiniteQuery({
    queryKey: qk.ratingCalculations(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<RatingCalculationEntry>>('/admin/rating/calculations', {
        query: { ...filters, cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <CardTitle className="mb-0">{t('journal')}</CardTitle>
        <label className="text-sm">
          <span className="mr-2 text-slate-600">{t('status')}</span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as RatingCalculationStatus | '')}
            className="w-auto"
          >
            <option value="">{t('allStatuses')}</option>
            {RATING_CALCULATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`calculationStatuses.${s}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {report ? (
        <Alert tone="success" className="mb-3">
          {t('recalculated', { ...report })}
        </Alert>
      ) : null}
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={tc('noData')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('when')}</Th>
                    <Th>{t('match')}</Th>
                    <Th>{t('athletesColumn')}</Th>
                    <Th>{t('status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <Td className="whitespace-nowrap">
                        {formatDateTime(r.processedAt ?? r.createdAt, locale)}
                        <div className="text-xs text-slate-500">{r.calculationVersion}</div>
                      </Td>
                      <Td>
                        {r.competition.name}
                        <div className="text-xs text-slate-600">
                          {[
                            r.match.number ? t('matchNumber', { number: r.match.number }) : null,
                            locale === 'en' ? r.match.category.en : r.match.category.ru,
                            r.matchResultRevision > 1
                              ? t('revision', { revision: r.matchResultRevision })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </Td>
                      <Td>
                        <ul className="space-y-1">
                          {r.athletes.map((a) => (
                            <li key={a.athleteId}>
                              <Link
                                href={`/admin/rating/athletes/${a.athleteId}`}
                                className="text-blue-700 hover:underline"
                              >
                                {a.name}
                              </Link>{' '}
                              {a.ratingBefore !== null ? (
                                <span className="text-xs tabular-nums">
                                  {a.ratingBefore} → {a.ratingAfter} (<Delta value={a.delta} />)
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </Td>
                      <Td>
                        <CalculationStatus status={r.status} />
                        {r.statusReason ? (
                          <div className="mt-1 text-xs text-slate-600">
                            {t.has(`reasons.${r.statusReason}`)
                              ? t(`reasons.${r.statusReason}`)
                              : r.statusReason}
                          </div>
                        ) : null}
                        {canRecalculate && (r.status === 'PENDING' || r.status === 'FAILED') ? (
                          <div className="mt-2">
                            <ReasonAction
                              size="sm"
                              label={t('recalculate')}
                              title={t('recalculateTitle', { name: r.competition.name })}
                              description={t('recalculateBody')}
                              onConfirm={async (reason) => {
                                const res = await api<DataEnvelope<RatingRecalculationReport>>(
                                  `/admin/competitions/${r.competition.id}/recalculate-rating`,
                                  { method: 'POST', body: { reason } },
                                );
                                setReport(res.data);
                                await queryClient.invalidateQueries({ queryKey: ['admin', 'rating'] });
                              }}
                            />
                          </div>
                        ) : null}
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
                  {tc('loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </Card>
  );
}

export function AdminRating() {
  const t = useTranslations('ratingAdmin');
  return (
    <>
      <PageHeader title={t('title')} description={t('lead')} />
      <div className="grid gap-6 [&>*]:min-w-0">
        <Summary />
        <AthleteSearch />
        <CalculationJournal />
      </div>
    </>
  );
}
