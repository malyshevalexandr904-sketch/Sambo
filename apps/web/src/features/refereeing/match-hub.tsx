'use client';
// Страница схватки (план Phase 7b): пара, счёт, результат и его прежние варианты, врач на ковре; действия по
// правам и состоянию (allowedActions схватки) — перенос и возврат в очередь, отмена (только вне сетки), изменение
// подтверждённого результата (главный судья), врач на ковре, протокол на печать. Открывается из сетки, расписания,
// раздела «Судейство» и подтверждения результатов.
import type { Competition, MatchDetailDto, MatchSideDto, Side } from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, cn, EmptyState, PageHeader } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { useCompetition } from '@/features/competitions/shared';
import { resultKeys, useInvalidateResults, useMatch, useMatchIncidents } from '@/features/results/api';
import { timeInZone, useRoundLabel } from '@/features/scheduling/shared';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { pickName } from '@/lib/queries';
import { AmendForm } from './amend-form';
import { confirmResult, transitionMatch } from './api';
import { DoctorPanel, IncidentList } from './doctor-panel';
import { useRefereeLabels } from './labels';
import { useDescribe } from './tablet-parts';

const LINK =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50';

function Corner({
  side,
  info,
  points,
  won,
}: {
  side: Side;
  info: MatchSideDto;
  points: number | null;
  won: boolean;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border-l-8 p-3',
        side === 'RED' ? 'border-red-600 bg-red-50' : 'border-blue-600 bg-blue-50',
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-600">{label.side(side)}</p>
        <p className={cn('text-xl', won ? 'font-bold' : 'font-medium')}>
          {info.publicName ?? (info.bye ? '—' : t('waitingParticipants'))}
          {won ? <span aria-label={t('winner')}> ✓</span> : null}
        </p>
        <p className="text-sm text-slate-600">
          {[info.club, info.region].filter(Boolean).join(', ')}
          {info.withdrawn ? (
            <Badge tone="warning" className="ml-2">
              {t('withdrawn')}
            </Badge>
          ) : null}
        </p>
      </div>
      {points !== null ? <span className="font-mono text-3xl font-bold tabular-nums">{points}</span> : null}
    </div>
  );
}

function ResultCard({ match }: { match: MatchDetailDto }) {
  const t = useTranslations('referee');
  const locale = useLocale();
  const label = useRefereeLabels();
  const r = match.result;
  if (!r) return null;
  const name = (s: Side): string => (s === 'RED' ? match.red : match.blue).publicName ?? '';
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CardTitle className="mb-0">{t('hub.result')}</CardTitle>
        <Badge tone={r.status === 'PROVISIONAL' ? 'warning' : r.status === 'AMENDED' ? 'info' : 'success'}>
          {t(`resultStatuses.${r.status}`)}
        </Badge>
        {r.system ? <Badge tone="neutral">{t('hub.system')}</Badge> : null}
      </div>
      <p className="text-lg">
        {r.winnerSide
          ? t('summary', {
              winner: `${label.side(r.winnerSide)} — ${name(r.winnerSide)}`,
              method: label.method(r.method, r.methodDetail),
              red: r.redScore ?? 0,
              blue: r.blueScore ?? 0,
            })
          : t('summaryBoth', { method: label.method(r.method) })}
      </p>
      {r.reason ? (
        <p className="mt-1 text-sm text-slate-700">{`${t('reason')}: ${label.reason(r.reason)}`}</p>
      ) : null}
      <dl className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
        {r.proposedAt ? (
          <div>
            <dt className="inline">{t('hub.recordedBy')}: </dt>
            <dd className="inline">
              {r.proposedBy?.displayName ?? '—'}, {formatDateTime(r.proposedAt, locale)}
            </dd>
          </div>
        ) : null}
        {r.confirmedAt ? (
          <div>
            <dt className="inline">{t('hub.confirmedBy')}: </dt>
            <dd className="inline">
              {r.confirmedBy?.displayName ?? '—'}, {formatDateTime(r.confirmedAt, locale)}
            </dd>
          </div>
        ) : null}
      </dl>
      {match.revisions.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{t('hub.revisions')}</h3>
          <ol className="space-y-1 text-sm text-slate-700">
            {match.revisions.map((v) => (
              <li key={v.revision}>
                <span className="text-slate-500">{t('hub.revisionN', { n: v.revision })}: </span>
                {v.winnerSide
                  ? t('summary', {
                      winner: `${label.side(v.winnerSide)} — ${name(v.winnerSide)}`,
                      method: label.method(v.method, v.methodDetail),
                      red: v.redScore ?? 0,
                      blue: v.blueScore ?? 0,
                    })
                  : t('summaryBoth', { method: label.method(v.method) })}
                <span className="block text-slate-500">
                  {t('hub.replaced', {
                    by: v.changedBy?.displayName ?? '—',
                    at: formatDateTime(v.changedAt, locale),
                    reason: v.reason,
                  })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

function Actions({ match, onChanged }: { match: MatchDetailDto; onChanged: (m?: MatchDetailDto) => void }) {
  const t = useTranslations('referee');
  const describe = useDescribe();
  const can = (a: string): boolean => match.allowedActions.includes(a as never);
  const [amending, setAmending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ data: MatchDetailDto }>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onChanged((await fn()).data);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const postpone = match.status !== 'POSTPONED' && can('transition:POSTPONED');
  const giveBack = match.status === 'POSTPONED' && can('transition:SCHEDULED');
  const cancel = can('transition:CANCELLED');
  const confirm = can('result.confirm');
  const amend = can('result.amend');
  if (!postpone && !giveBack && !cancel && !confirm && !amend) return null;
  return (
    <Card>
      <CardTitle>{t('hub.actions')}</CardTitle>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {amending ? (
        <AmendForm
          match={match}
          onCancel={() => setAmending(false)}
          onDone={(m) => {
            setAmending(false);
            onChanged(m);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {confirm ? (
            <Button size="lg" loading={busy} onClick={() => void run(() => confirmResult(match))}>
              {t('confirmResult')}
            </Button>
          ) : null}
          {amend ? (
            <Button size="lg" variant="secondary" onClick={() => setAmending(true)}>
              {t('amend.action')}
            </Button>
          ) : null}
          {giveBack ? (
            <Button
              size="lg"
              loading={busy}
              onClick={() => void run(() => transitionMatch(match, 'SCHEDULED'))}
            >
              {t('hub.return')}
            </Button>
          ) : null}
          {postpone ? (
            <ReasonAction
              label={t('hub.postpone')}
              title={t('hub.postponeTitle')}
              description={t('hub.postponeHint')}
              describeError={describe}
              onConfirm={async (reason) => {
                onChanged((await transitionMatch(match, 'POSTPONED', reason)).data);
              }}
            />
          ) : null}
          {cancel ? (
            <ReasonAction
              label={t('hub.cancel')}
              title={t('hub.cancelTitle')}
              description={t('hub.cancelHint')}
              variant="danger"
              describeError={describe}
              onConfirm={async (reason) => {
                onChanged((await transitionMatch(match, 'CANCELLED', reason)).data);
              }}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Hub({ match, competition }: { match: MatchDetailDto; competition: Competition | undefined }) {
  const t = useTranslations('referee');
  const locale = useLocale();
  const round = useRoundLabel();
  const qc = useQueryClient();
  const invalidate = useInvalidateResults();
  const tz = competition?.timezone ?? 'UTC';
  const medical = competition?.allowedActions.includes('medical.view') ?? false;
  const incidents = useMatchIncidents(match.id, medical && match.incidents.length > 0);
  const onChanged = (m?: MatchDetailDto): void => {
    if (m) qc.setQueryData(resultKeys.match(m.id), m);
    void invalidate();
  };
  const r = match.result;
  const won = (s: Side): boolean => !!r && r.status !== 'PROVISIONAL' && r.winnerSide === s;
  const awaiting = match.status === 'FINISHED' && r?.status === 'PROVISIONAL';
  return (
    <>
      <PageHeader
        title={`${match.number !== null ? t('match', { number: match.number }) : t('hub.untitled')} · ${round(match.roundLabel)}`}
        description={[
          pickName(match.categoryName, locale),
          match.mat ? t('matTitle', { number: match.mat.number }) : null,
          match.plannedAt ? timeInZone(match.plannedAt, tz, locale) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Link href={`/referee/${match.competitionId}`} className={LINK}>
              {t('backToMats')}
            </Link>
            {match.mat ? (
              <Link href={`/referee/${match.competitionId}/mats/${match.mat.id}`} className={LINK}>
                {t('openTablet')}
              </Link>
            ) : null}
            {match.allowedActions.includes('protocol') ? (
              <Link href={`/protocols/matches/${match.id}`} className={LINK} target="_blank">
                {t('hub.protocol')}
              </Link>
            ) : null}
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              match.status === 'IN_PROGRESS' ? 'success' : match.status === 'POSTPONED' ? 'warning' : 'info'
            }
          >
            {awaiting ? t('awaitingConfirmation') : t(`matchStatuses.${match.status}`)}
          </Badge>
          {match.manual ? <Badge tone="neutral">{t('hub.manual')}</Badge> : null}
          {match.incidents.length > 0 ? (
            <Badge tone="danger">
              <span aria-hidden="true">✚</span> {t('doctor.onMat')}
            </Badge>
          ) : null}
        </div>
        {match.status === 'POSTPONED' ? <Alert tone="warning">{t('hub.postponedHint')}</Alert> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Corner
            side="RED"
            info={match.red}
            points={r && r.method !== 'BYE' ? r.redScore : (match.state?.red.points ?? null)}
            won={won('RED')}
          />
          <Corner
            side="BLUE"
            info={match.blue}
            points={r && r.method !== 'BYE' ? r.blueScore : (match.state?.blue.points ?? null)}
            won={won('BLUE')}
          />
        </div>
        {match.allowedActions.includes('medical.record') ? (
          <DoctorPanel match={match} onDone={onChanged} />
        ) : null}
        <ResultCard match={match} />
        <Actions match={match} onChanged={onChanged} />
        {match.incidents.length > 0 ? (
          <Card>
            <CardTitle>{t('doctor.records')}</CardTitle>
            {medical ? <p className="mb-2 text-sm text-slate-600">{t('doctor.notesLogged')}</p> : null}
            <IncidentList incidents={medical && incidents.data ? incidents.data : match.incidents} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function MatchHub({ competitionId, matchId }: { competitionId: string; matchId: string }) {
  const t = useTranslations('referee');
  const query = useMatch(matchId);
  const competition = useCompetition(competitionId);
  if (query.error instanceof ApiError && query.error.code === 'NOT_FOUND')
    return <EmptyState title={t('hub.notFound')} />;
  return (
    <QueryState isPending={query.isPending} error={query.data ? null : query.error}>
      {() => <Hub match={query.data as MatchDetailDto} competition={competition.data} />}
    </QueryState>
  );
}
