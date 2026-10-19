'use client';
// Рейтинг спортсмена в кабинете администратора платформы (ТЗ 18, 65–67; фаза 14): текущее значение и статус,
// ручная корректировка, заморозка, отчёт пересборки и его применение, журнал корректировок и расчётов. Каждое
// действие — с причиной; история не переписывается.
import type {
  AdminAthleteRating,
  DataEnvelope,
  Page,
  RatingCorrectionDto,
  RatingRebuildReport,
  RatingStatus,
} from '@sde/contracts';
import { RATING_STATUSES } from '@sde/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  Textarea,
  Th,
} from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { hasPlatformPermission } from '@/components/app-shell';
import { QueryState, ReasonAction } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { qk, useMe } from '@/lib/queries';
import { CalculationJournal, Delta } from './admin-rating';

function StatusTag({ status }: { status: RatingStatus }) {
  const t = useTranslations('ratingAdmin.ratingStatuses');
  return <Badge tone={status === 'ACTIVE' ? 'success' : 'warning'}>{t(status)}</Badge>;
}

/** Ручная корректировка: новое значение и причина; сервер сверяет текущее с тем, что видно на экране. */
function CorrectionForm({ rating, onDone }: { rating: AdminAthleteRating; onDone: () => Promise<void> }) {
  const t = useTranslations('ratingAdmin');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(String(rating.rating));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = Number(value);
  const valid =
    value.trim() !== '' && Number.isInteger(next) && next !== rating.rating && reason.trim().length >= 5;
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/admin/athletes/${rating.athleteId}/rating-corrections`, {
            method: 'POST',
            body: { correctedRating: next, expectedRating: rating.rating, reason: reason.trim() },
          });
          setReason('');
          await onDone();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        id="corrected-rating"
        label={t('newRating')}
        hint={t('newRatingHint', { current: rating.rating })}
      >
        <Input
          id="corrected-rating"
          type="number"
          inputMode="numeric"
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Field id="correction-reason" label={tc('reason')} hint={tc('reasonHint')}>
        <Textarea
          id="correction-reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={!valid} loading={busy}>
          {t('applyCorrection')}
        </Button>
      </div>
    </form>
  );
}

function RebuildSection({ rating, onDone }: { rating: AdminAthleteRating; onDone: () => Promise<void> }) {
  const t = useTranslations('ratingAdmin');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const { data: me } = useMe();
  const canApply = hasPlatformPermission(me, 'rating.rebuild_apply');
  const [report, setReport] = useState<RatingRebuildReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const build = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DataEnvelope<RatingRebuildReport>>(
        `/admin/athletes/${rating.athleteId}/rebuild-rating`,
        {
          method: 'POST',
          body: {},
        },
      );
      setReport(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('rebuild')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('rebuildLead')}</p>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Button variant="secondary" loading={busy} onClick={() => void build()}>
        {report ? t('rebuildAgain') : t('rebuildRun')}
      </Button>
      {report ? (
        <div className="mt-4">
          <Alert tone={report.discrepancy === 0 ? 'success' : 'warning'}>
            {report.discrepancy === 0
              ? t('rebuildMatches', { rating: report.currentRating })
              : t('rebuildDiffers', {
                  current: report.currentRating,
                  rebuilt: report.rebuiltRating,
                  discrepancy: report.discrepancy > 0 ? `+${report.discrepancy}` : `−${-report.discrepancy}`,
                })}
          </Alert>
          {report.applied ? (
            <Alert tone="success" className="mt-2">
              {t('rebuildApplied', { rating: report.applied.ratingAfter })}
            </Alert>
          ) : null}
          {report.discrepancy !== 0 && !report.applied ? (
            canApply ? (
              <div className="mt-3">
                <ReasonAction
                  variant="danger"
                  label={t('rebuildApply', { rating: report.rebuiltRating })}
                  title={t('rebuildApplyTitle')}
                  description={t('rebuildApplyBody', {
                    current: report.currentRating,
                    rebuilt: report.rebuiltRating,
                  })}
                  onConfirm={async (reason) => {
                    const res = await api<DataEnvelope<RatingRebuildReport>>(
                      `/admin/athletes/${rating.athleteId}/rebuild-rating/apply`,
                      { method: 'POST', body: { expectedRating: report.rebuiltRating, reason } },
                    );
                    setReport(res.data);
                    await onDone();
                  }}
                />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">{t('rebuildApplyForbidden')}</p>
            )
          ) : null}
          <p className="mt-3 text-sm text-slate-600">{t('rebuildStart', { rating: report.initialRating })}</p>
          {report.steps.length > 0 ? (
            <Table className="mt-2">
              <thead>
                <tr>
                  <Th>{t('when')}</Th>
                  <Th>{t('step')}</Th>
                  <Th className="text-right">{t('recorded')}</Th>
                  <Th className="text-right">{t('rebuilt')}</Th>
                </tr>
              </thead>
              <tbody>
                {report.steps.map((s, i) => {
                  const differs = s.recorded.after !== s.rebuilt.after;
                  return (
                    <tr key={i} className={differs ? 'bg-amber-50' : undefined}>
                      <Td className="whitespace-nowrap">{formatDateTime(s.at, locale)}</Td>
                      <Td>
                        {s.kind === 'MATCH'
                          ? t('stepMatch', {
                              outcome: s.outcome ? t(`outcomes.${s.outcome}`) : '—',
                              opponent: s.opponentRatingBefore ?? '—',
                            })
                          : t('stepCorrection')}
                        {s.calculationVersion ? (
                          <div className="text-xs text-slate-500">{s.calculationVersion}</div>
                        ) : null}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {s.recorded.before} → {s.recorded.after} (<Delta value={s.recorded.delta} />)
                      </Td>
                      <Td className="text-right tabular-nums">
                        {s.rebuilt.before} → {s.rebuilt.after} (<Delta value={s.rebuilt.delta} />)
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Corrections({ athleteId }: { athleteId: string }) {
  const t = useTranslations('ratingAdmin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const list = useQuery({
    queryKey: qk.ratingCorrections(athleteId),
    queryFn: () =>
      api<Page<RatingCorrectionDto>>(`/admin/athletes/${athleteId}/rating-corrections`, {
        query: { limit: 100 },
      }),
  });
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('corrections')}</CardTitle>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          (list.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">{tc('noData')}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('when')}</Th>
                  <Th>{t('kind')}</Th>
                  <Th className="text-right">{t('change')}</Th>
                  <Th>{tc('reason')}</Th>
                </tr>
              </thead>
              <tbody>
                {(list.data?.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(c.createdAt, locale)}</Td>
                    <Td>{t(`correctionKinds.${c.kind}`)}</Td>
                    <Td className="text-right tabular-nums">
                      {c.ratingBefore} → {c.ratingAfter} (<Delta value={c.delta} />)
                    </Td>
                    <Td className="max-w-80">{c.reason ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </Card>
  );
}

export function AdminAthleteRatingView({ id }: { id: string }) {
  const t = useTranslations('ratingAdmin');
  const locale = useLocale();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canCorrect = hasPlatformPermission(me, 'rating.correct');
  const rating = useQuery({
    queryKey: qk.ratingAthlete(id),
    queryFn: async () => (await api<DataEnvelope<AdminAthleteRating>>(`/admin/athletes/${id}/rating`)).data,
  });
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['admin', 'rating'] });
  return (
    <QueryState isPending={rating.isPending} error={rating.error}>
      {() => {
        const r = rating.data as AdminAthleteRating;
        return (
          <>
            <p className="mb-2 text-sm">
              <Link href="/admin/rating" className="text-blue-700 hover:underline">
                ← {t('title')}
              </Link>
            </p>
            <PageHeader
              title={r.name}
              description={t('athleteLead')}
              actions={<StatusTag status={r.status} />}
            />
            <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <CardTitle>{t('current')}</CardTitle>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-500">{t('rating')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {r.rating} <span className="text-sm font-normal">{t('level', { level: r.level })}</span>
                  </dd>
                  <dt className="text-slate-500">{t('peakLowest')}</dt>
                  <dd className="tabular-nums">
                    {r.peakRating} / {r.lowestRating}
                  </dd>
                  <dt className="text-slate-500">{t('record')}</dt>
                  <dd className="tabular-nums">
                    {t('recordValue', { matches: r.ratedMatches, wins: r.wins, losses: r.losses })}
                  </dd>
                  <dt className="text-slate-500">{t('pending')}</dt>
                  <dd className="tabular-nums">{r.pendingCalculations}</dd>
                  <dt className="text-slate-500">{t('updated')}</dt>
                  <dd>{r.updatedAt ? formatDateTime(r.updatedAt, locale) : t('noRating')}</dd>
                </dl>
                <p className="mt-3 text-sm">
                  <Link href={`/rating/${r.publicId}`} className="text-blue-700 hover:underline">
                    {t('publicCard')}
                  </Link>
                </p>
                {canCorrect ? (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="mb-2 text-sm text-slate-600">{t('statusHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {RATING_STATUSES.filter((s) => s !== r.status).map((s) => (
                        <ReasonAction
                          key={s}
                          variant={s === 'ACTIVE' ? 'secondary' : 'danger'}
                          label={t(`statusActions.${s}`)}
                          title={t(`statusActions.${s}`)}
                          description={t(`statusEffects.${s}`)}
                          onConfirm={async (reason) => {
                            await api(`/admin/athletes/${r.athleteId}/rating-status`, {
                              method: 'PUT',
                              body: { status: s, reason },
                            });
                            await refresh();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
              {canCorrect ? (
                <Card>
                  <CardTitle>{t('manualCorrection')}</CardTitle>
                  <p className="mb-3 text-sm text-slate-600">{t('manualCorrectionLead')}</p>
                  <CorrectionForm key={r.rating} rating={r} onDone={refresh} />
                </Card>
              ) : null}
              {hasPlatformPermission(me, 'competition.recalculate_rating') ? (
                <RebuildSection rating={r} onDone={refresh} />
              ) : null}
              <Corrections athleteId={r.athleteId} />
              <div className="xl:col-span-2">
                <CalculationJournal athleteId={r.athleteId} />
              </div>
            </div>
          </>
        );
      }}
    </QueryState>
  );
}
