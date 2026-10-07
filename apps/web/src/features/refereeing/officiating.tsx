'use client';
// Раздел «Судейство» (план Phase 7a, §5): турниры, где пользователь в персонале и идут (или вот-вот начнутся)
// схватки; ковры турнира текущей сессии — свои сверху, с переходом на планшет ковра; подтверждение результатов
// для руководителя ковра и главного судьи — список, удобный с телефона.
import type { CompetitionSummary, Page, PendingConfirmationDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { pickName } from '@/lib/queries';
import { CompetitionStatusBadge, formatDates } from '@/features/competitions/shared';
import { timeInZone, useRoundLabel } from '@/features/scheduling/shared';
import { confirmResult, refereeKeys, useOfficiating, usePendingConfirmations } from './api';
import { useRefereeLabels } from './labels';

const LINK_BUTTON =
  'inline-flex min-h-12 items-center justify-center rounded-md px-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';
const PRIMARY = `${LINK_BUTTON} bg-blue-700 text-white hover:bg-blue-800`;
const SECONDARY = `${LINK_BUTTON} border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`;

function useMyLiveCompetitions() {
  const fetchStatus = async (status: string): Promise<CompetitionSummary[]> =>
    (await api<Page<CompetitionSummary>>('/competitions', { query: { mine: 'true', status, limit: 50 } }))
      .data;
  return useQuery({
    queryKey: ['competitions', 'officiating-list'],
    queryFn: async () => {
      const [live, scheduled] = await Promise.all([fetchStatus('IN_PROGRESS'), fetchStatus('SCHEDULED')]);
      return [...live, ...scheduled];
    },
  });
}

export function RefereeHome() {
  const t = useTranslations('referee');
  const locale = useLocale();
  const query = useMyLiveCompetitions();
  return (
    <>
      <PageHeader title={t('title')} description={t('hint')} />
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          (query.data ?? []).length === 0 ? (
            <EmptyState title={t('noCompetitions')} />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {(query.data ?? []).map((c) => (
                <li key={c.id}>
                  <Card className="flex h-full flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold">{c.name}</h2>
                      <CompetitionStatusBadge status={c.status} />
                    </div>
                    <p className="text-sm text-slate-600">
                      {formatDates(c.startDate, c.endDate, locale)}
                      {c.venue ? ` · ${c.venue.city ?? c.venue.name}` : ''}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <Link href={`/referee/${c.id}`} className={PRIMARY}>
                        {t('mats')}
                      </Link>
                      <Link href={`/referee/${c.id}/confirmations`} className={SECONDARY}>
                        {t('confirmations')}
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}

export function OfficiatingMats({ competitionId }: { competitionId: string }) {
  const t = useTranslations('referee');
  const tRoles = useTranslations('scheduling.crews.roles');
  const tStatus = useTranslations('referee.matchStatuses');
  const locale = useLocale();
  const round = useRoundLabel();
  const query = useOfficiating(competitionId);
  return (
    <QueryState isPending={query.isPending} error={query.data ? null : query.error}>
      {() => {
        const data = query.data!;
        const session = data.sessions.find((s) => s.id === data.currentSessionId) ?? null;
        const tz = data.competition.timezone;
        return (
          <>
            <PageHeader
              title={`${t('title')}: ${data.competition.name}`}
              description={
                session
                  ? `${t('session', { name: session.name })} · ${timeInZone(session.startsAt, tz, locale)}–${timeInZone(session.endsAt, tz, locale)}`
                  : t('noSession')
              }
              actions={
                <Link href={`/referee/${competitionId}/confirmations`} className={SECONDARY}>
                  {t('confirmations')}
                  {data.pendingConfirmations > 0 ? (
                    <Badge tone="warning" className="ml-2">
                      {data.pendingConfirmations}
                    </Badge>
                  ) : null}
                </Link>
              }
            />
            {data.mats.length === 0 ? (
              <EmptyState title={t('noMatch')} />
            ) : (
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.mats.map((mat) => {
                  const c = mat.current;
                  const mine = mat.myRoles.length > 0;
                  return (
                    <li key={mat.id}>
                      <Card className={`flex h-full flex-col gap-3 ${mine ? 'ring-2 ring-blue-600' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="text-xl font-semibold">
                            {t('matTitle', { number: mat.number })} {mat.name ?? ''}
                          </h2>
                          {mat.awaitingConfirmation > 0 ? (
                            <Badge tone="warning">
                              {t('awaitingCount', { count: mat.awaitingConfirmation })}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-600">
                          {mine
                            ? t('myRoles', { roles: mat.myRoles.map((r) => tRoles(r)).join(', ') })
                            : t('notAssigned')}
                        </p>
                        {c ? (
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                              <Badge
                                tone={
                                  c.status === 'IN_PROGRESS'
                                    ? 'success'
                                    : c.status === 'PAUSED'
                                      ? 'warning'
                                      : 'info'
                                }
                              >
                                {tStatus(c.status)}
                              </Badge>
                              {c.number !== null ? t('match', { number: c.number }) : ''} ·{' '}
                              {round(c.roundLabel)} · {pickName(c.categoryName, locale)}
                              {c.plannedAt ? ` · ${timeInZone(c.plannedAt, tz, locale)}` : ''}
                            </p>
                            <p className="mt-1 font-medium">
                              <span className="text-red-800">
                                {c.red.publicName ?? t('waitingParticipants')}
                              </span>
                              {' — '}
                              <span className="text-blue-800">
                                {c.blue.publicName ?? t('waitingParticipants')}
                              </span>
                            </p>
                          </div>
                        ) : (
                          <p className="text-slate-500">{t('noMatch')}</p>
                        )}
                        <div className="mt-auto flex flex-wrap gap-2">
                          <Link
                            href={`/referee/${competitionId}/mats/${mat.id}`}
                            className={mine ? PRIMARY : SECONDARY}
                          >
                            {t('openTablet')}
                          </Link>
                          <Link
                            href={`/competitions/${competitionId}/mats/${mat.id}/queue`}
                            className={SECONDARY}
                          >
                            {t('openQueue')}
                          </Link>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        );
      }}
    </QueryState>
  );
}

function PendingCard({
  item,
  timezone,
  onConfirmed,
}: {
  item: PendingConfirmationDto;
  timezone: string | null;
  onConfirmed: () => void;
}) {
  const t = useTranslations('referee');
  const locale = useLocale();
  const round = useRoundLabel();
  const label = useRefereeLabels();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = item.result;
  const winnerName = r?.winnerSide
    ? r.winnerSide === 'RED'
      ? item.red.publicName
      : item.blue.publicName
    : null;
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-sm text-slate-600">
        {item.number !== null ? t('match', { number: item.number }) : ''} · {round(item.roundLabel)} ·{' '}
        {pickName(item.categoryName, locale)}
        {item.mat ? ` · ${t('matTitle', { number: item.mat.number })}` : ''}
        {item.plannedAt && timezone ? ` · ${timeInZone(item.plannedAt, timezone, locale)}` : ''}
      </p>
      <p className="text-lg font-medium">
        <span className={r?.winnerSide === 'RED' ? 'font-bold text-red-800' : 'text-red-800'}>
          {item.red.publicName}
        </span>
        {' — '}
        <span className={r?.winnerSide === 'BLUE' ? 'font-bold text-blue-800' : 'text-blue-800'}>
          {item.blue.publicName}
        </span>
      </p>
      {r ? (
        <p>
          {r.winnerSide && winnerName
            ? t('summary', {
                winner: `${label.side(r.winnerSide)} — ${winnerName}`,
                method: label.method(r.method, r.methodDetail),
                red: r.redScore ?? 0,
                blue: r.blueScore ?? 0,
              })
            : t('summaryBoth', { method: label.method(r.method) })}
          {r.reason ? (
            <span className="block text-sm text-slate-600">{`${t('reason')}: ${r.reason}`}</span>
          ) : null}
        </p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {item.canConfirm ? (
        <Button
          size="lg"
          className="self-start"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await confirmResult(item);
              onConfirmed();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('confirm')}
        </Button>
      ) : (
        <p className="text-sm text-slate-500">{t('chiefOnly')}</p>
      )}
    </Card>
  );
}

export function Confirmations({ competitionId }: { competitionId: string }) {
  const t = useTranslations('referee');
  const qc = useQueryClient();
  const query = usePendingConfirmations(competitionId);
  const officiating = useOfficiating(competitionId);
  const [done, setDone] = useState(false);
  const refresh = (): void => {
    setDone(true);
    void qc.invalidateQueries({ queryKey: refereeKeys.pending(competitionId) });
    void qc.invalidateQueries({ queryKey: refereeKeys.officiating(competitionId) });
  };
  return (
    <>
      <PageHeader
        title={t('confirmations')}
        description={t('confirmationsHint')}
        actions={
          <Link href={`/referee/${competitionId}`} className={SECONDARY}>
            {t('backToMats')}
          </Link>
        }
      />
      {done ? (
        <Alert tone="success" className="mb-4">
          {t('confirmedToast')}
        </Alert>
      ) : null}
      <QueryState isPending={query.isPending} error={query.data ? null : query.error}>
        {() =>
          (query.data ?? []).length === 0 ? (
            <EmptyState title={t('noConfirmations')} />
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {(query.data ?? []).map((item) => (
                <li key={item.id}>
                  <PendingCard
                    item={item}
                    timezone={officiating.data?.competition.timezone ?? null}
                    onConfirmed={refresh}
                  />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}
