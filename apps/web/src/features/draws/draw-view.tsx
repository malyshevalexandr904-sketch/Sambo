'use client';
// Версия жеребьёвки: seed и хеш входа (ADR-11), отчёт о разведении, публикация с перечнем последствий,
// новая версия с причиной, проверка повтора по seed, сетка и её печать.
import {
  type Competition,
  type DataEnvelope,
  type DrawDto,
  type DrawVerifyDto,
  eliminationRoundLabel,
  isEliminationFormat,
  type SeparationReportDto,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { BracketView } from './bracket-view';
import { DrawStatusBadge, useCommandError, useFormatLabel } from './shared';

function SeparationReport({ report, size }: { report: SeparationReportDto; size: number }) {
  const t = useTranslations('draws.separation');
  const rounds = useTranslations('bracket.rounds');
  if (!report.applicable) return <p className="text-sm text-slate-600">{t('notApplicable')}</p>;
  if (report.groups.length === 0) return <p className="text-sm text-slate-600">{t('none')}</p>;
  const roundText = (r: number): string => rounds(eliminationRoundLabel(size, r));
  return (
    <div className="space-y-2">
      {report.unmet > 0 ? <Alert tone="warning">{t('unmetCount', { count: report.unmet })}</Alert> : null}
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
        {report.groups.map((g) => {
          const met = g.achievedRound >= g.idealRound;
          return (
            <li key={`${g.key}-${g.value}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
              <Badge tone="neutral">{t(`keys.${g.key}`)}</Badge>
              <span className="font-medium">{g.name ?? '—'}</span>
              <span className="text-slate-600">{t('athletes', { count: g.size })}</span>
              <span className="flex w-full flex-wrap items-center gap-2 text-slate-600 sm:ml-auto sm:w-auto">
                {t('meet', { round: roundText(g.achievedRound) })}
                <Badge tone={met ? 'success' : 'warning'}>
                  <span aria-hidden="true">{met ? '●' : '◐'}</span>
                  {met ? t('met') : t('unmet', { round: roundText(g.idealRound) })}
                </Badge>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PublishAction({ draw, onDone }: { draw: DrawDto; onDone: () => Promise<void> }) {
  const t = useTranslations('draws.publish');
  const describe = useCommandError();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button onClick={() => setOpen(true)}>{t('action')}</Button>;
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/draws/${draw.id}/publish`, { method: 'POST', body: {}, version: draw.version });
      setOpen(false);
      await onDone();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="w-full rounded-md border border-blue-200 bg-blue-50 p-3"
      role="group"
      aria-label={t('title')}
    >
      <p className="font-medium">{t('title')}</p>
      <p className="mt-1 text-sm text-slate-700">{t('consequences')}</p>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button loading={busy} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

function VerifyAction({ draw }: { draw: DrawDto }) {
  const t = useTranslations('draws.verify');
  const action = useAction();
  const [result, setResult] = useState<DrawVerifyDto | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        loading={action.busy}
        onClick={() =>
          void action.run(async () => {
            const r = await api<DataEnvelope<DrawVerifyDto>>(`/draws/${draw.id}/verify`, {
              method: 'POST',
              body: {},
            });
            setResult(r.data);
          })
        }
      >
        {t('action')}
      </Button>
      {result ? (
        <span role="status" className="flex flex-wrap gap-2">
          <Badge tone={result.reproducible ? 'success' : 'danger'}>
            <span aria-hidden="true">{result.reproducible ? '●' : '■'}</span>
            {result.reproducible ? t('ok') : t('fail')}
          </Badge>
          <Badge tone={result.currentInput ? 'neutral' : 'warning'}>
            {result.currentInput ? t('current') : t('notCurrent')}
          </Badge>
        </span>
      ) : null}
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
    </div>
  );
}

export function DrawView({
  competition,
  draw,
  categoryName,
  newerDraft,
  onChanged,
}: {
  competition: Competition;
  draw: DrawDto;
  categoryName: string;
  /** В категории есть черновик новее этого: публикуется только последний. */
  newerDraft: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('draws');
  const locale = useLocale();
  const formatLabel = useFormatLabel();
  const describe = useCommandError();
  const can = (a: string): boolean => draw.allowedActions.includes(a);
  const date = (iso: string | null): string =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
      : '';
  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mb-0">{t('version', { number: draw.number })}</CardTitle>
          <DrawStatusBadge status={draw.status} />
          {draw.stale ? <Badge tone="warning">{t('staleShort')}</Badge> : null}
          {draw.manualSeed ? <Badge tone="info">{t('manualSeed')}</Badge> : null}
        </div>
        {draw.stale ? (
          <Alert tone="warning" className="mt-3">
            {t('stale')}
          </Alert>
        ) : null}
        {draw.status === 'DRAFT' && newerDraft ? (
          <Alert tone="info" className="mt-3">
            {t('notLatest')}
          </Alert>
        ) : null}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('details.format')}</dt>
            <dd>
              {formatLabel(draw.format)} · {t('participants', { count: draw.participants })}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('details.created')}</dt>
            <dd>
              {draw.createdBy?.displayName ?? '—'}, {date(draw.createdAt)}
            </dd>
          </div>
          {draw.publishedAt ? (
            <div>
              <dt className="text-slate-500">{t('details.published')}</dt>
              <dd>
                {draw.publishedBy?.displayName ?? '—'}, {date(draw.publishedAt)}
              </dd>
            </div>
          ) : null}
          {draw.supersededAt ? (
            <div>
              <dt className="text-slate-500">{t('details.superseded')}</dt>
              <dd>
                {draw.supersededBy?.displayName ?? '—'}, {date(draw.supersededAt)}: {draw.supersedeReason}
              </dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-slate-500">{t('details.seed')}</dt>
            <dd className="break-all font-mono text-xs">
              {draw.randomSeed} · {t('details.inputHash')} {draw.inputHash.slice(0, 16)}… ·{' '}
              {draw.algorithmVersion}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {can('draw.publish') ? <PublishAction draw={draw} onDone={onChanged} /> : null}
          {can('draw.supersede') ? (
            <ReasonAction
              label={t('supersede.action')}
              title={t('supersede.title')}
              description={t('supersede.description')}
              variant="danger"
              describeError={describe}
              onConfirm={async (reason) => {
                await api(`/draws/${draw.id}/supersede`, {
                  method: 'POST',
                  body: { reason },
                  version: draw.version,
                });
                await onChanged();
              }}
            />
          ) : null}
          <VerifyAction draw={draw} />
          <Button variant="secondary" onClick={() => window.print()}>
            {t('print')}
          </Button>
        </div>
      </Card>
      {isEliminationFormat(draw.format) ? (
        <Card className="print:hidden">
          <CardTitle>{t('separation.title')}</CardTitle>
          <SeparationReport report={draw.separation} size={draw.bracket.size} />
        </Card>
      ) : null}
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <div className="mb-3 hidden print:block">
          <p className="text-lg font-semibold">{competition.name}</p>
          <p>
            {categoryName} · {formatLabel(draw.format)} · {t('version', { number: draw.number })} (
            {t(`statuses.${draw.status}`)})
          </p>
        </div>
        <CardTitle className="print:hidden">
          {draw.status === 'DRAFT'
            ? t('previewTitle')
            : draw.status === 'SUPERSEDED'
              ? t('supersededTitle')
              : t('bracketTitle')}
        </CardTitle>
        <BracketView view={draw.bracket} />
      </Card>
    </div>
  );
}
