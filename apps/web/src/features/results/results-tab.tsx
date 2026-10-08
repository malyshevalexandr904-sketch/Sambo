'use client';
// Вкладка турнира «Итоги» (план Phase 7b, §1): категории с сеткой — сколько схваток решено и ждёт подтверждения,
// места и медали, публикация результатов с перечнем последствий, протокол категории; когда результаты всех
// категорий опубликованы — завершение турнира.
import type { CategoryResultsDto, Competition, CompetitionResultsDto, DataEnvelope } from '@sde/contracts';
import { Alert, Badge, Button, Card, EmptyState } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { CategoryStatusBadge } from '@/features/competitions/shared';
import { useCommandError, useFormatLabel } from '@/features/draws/shared';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { publishResults, useCompetitionResults, useInvalidateResults } from './api';
import { PlacementsTable, ResultStatusBadge } from './shared';

const LINK =
  'inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50';

function PublishAction({ category, onDone }: { category: CategoryResultsDto; onDone: () => Promise<void> }) {
  const t = useTranslations('results.publish');
  const describe = useCommandError();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button onClick={() => setOpen(true)}>{t('action')}</Button>;
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await publishResults(category);
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
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>{t('consequencePlaces')}</li>
        <li>{t('consequenceHistory')}</li>
        <li>{t('consequenceAmend')}</li>
      </ul>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
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

function Progress({ c }: { c: CategoryResultsDto }) {
  const t = useTranslations('results');
  const pct = c.matchesTotal > 0 ? Math.round((c.matchesDecided / c.matchesTotal) * 100) : 100;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
        <span>{t('matchesDecided', { decided: c.matchesDecided, total: c.matchesTotal })}</span>
        {c.awaitingConfirmation > 0 ? (
          <Badge tone="warning">{t('awaiting', { count: c.awaitingConfirmation })}</Badge>
        ) : null}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('progressLabel')}
      >
        <div className="h-full rounded-full bg-blue-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CategoryCard({
  c,
  competition,
  onChanged,
}: {
  c: CategoryResultsDto;
  competition: Competition;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('results');
  const locale = useLocale();
  const formatLabel = useFormatLabel();
  const canExport = competition.allowedActions.includes('export.create');
  const name = pickName(c.categoryName, locale);
  return (
    <Card className="space-y-3" aria-label={name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{name}</h3>
          <p className="text-sm text-slate-600">{formatLabel(c.format)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryStatusBadge status={c.categoryStatus} />
          {c.status && !(c.categoryStatus === 'RESULTS_PUBLISHED' && c.status === 'PUBLISHED') ? (
            <ResultStatusBadge status={c.status} />
          ) : null}
        </div>
      </div>
      <Progress c={c} />
      {c.placements.length > 0 ? (
        <PlacementsTable placements={c.placements} caption={t('placesOf', { category: name })} />
      ) : (
        <p className="text-sm text-slate-600">{t('noPlacesYet')}</p>
      )}
      {c.publishedAt ? (
        <p className="text-sm text-slate-600">
          {t('publishedBy', {
            name: c.publishedBy?.displayName ?? '—',
            at: formatDateTime(c.publishedAt, locale),
          })}
          {c.amendedAt ? ` · ${t('amendedAt', { at: formatDateTime(c.amendedAt, locale) })}` : ''}
        </p>
      ) : null}
      {c.categoryStatus === 'COMPLETED' && !c.canPublish ? (
        <p className="text-sm text-slate-600">{t('publishByChief')}</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        {c.canPublish ? <PublishAction category={c} onDone={onChanged} /> : null}
        <Link
          href={{
            pathname: `/competitions/${competition.id}`,
            query: { tab: 'draws', category: c.categoryId },
          }}
          className={LINK}
        >
          {t('bracket')}
        </Link>
        {c.awaitingConfirmation > 0 ? (
          <Link href={`/referee/${competition.id}/confirmations`} className={LINK}>
            {t('toConfirmations')}
          </Link>
        ) : null}
        {canExport ? (
          <Link href={`/protocols/categories/${c.categoryId}`} className={LINK} target="_blank">
            {t('categoryProtocol')}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function FinishCard({ competition, data }: { competition: Competition; data: CompetitionResultsDto }) {
  const t = useTranslations('results');
  const describe = useCommandError();
  const qc = useQueryClient();
  const invalidate = useInvalidateResults();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (competition.status === 'FINISHED' || competition.status === 'ARCHIVED')
    return <Alert tone="success">{t('finished')}</Alert>;
  if (competition.status !== 'IN_PROGRESS') return null;
  if (!data.allPublished) return <Alert tone="info">{t('finishHint')}</Alert>;
  if (!data.canFinish) return <Alert tone="success">{t('allPublished')}</Alert>;
  return (
    <Alert tone="success" title={t('allPublished')}>
      <p>{t('finishConsequences')}</p>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
      <Button
        className="mt-3"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await api<DataEnvelope<Competition>>(`/competitions/${competition.id}/transitions`, {
              method: 'POST',
              body: { to: 'FINISHED' },
              version: competition.version,
            });
            qc.setQueryData(qk.competition(competition.id), res.data);
            await invalidate();
          } catch (e) {
            setError(describe(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('finish')}
      </Button>
    </Alert>
  );
}

export function ResultsTab({ competition }: { competition: Competition }) {
  const t = useTranslations('results');
  const query = useCompetitionResults(competition.id);
  const invalidate = useInvalidateResults();
  return (
    <QueryState isPending={query.isPending} error={query.data ? null : query.error}>
      {() => {
        const data = query.data as CompetitionResultsDto;
        const total = data.categories.length;
        if (total === 0) return <EmptyState title={t('noCategories')}>{t('noCategoriesHint')}</EmptyState>;
        const completed = data.categories.filter((c) =>
          ['COMPLETED', 'RESULTS_PUBLISHED'].includes(c.categoryStatus),
        ).length;
        const published = data.categories.filter((c) => c.categoryStatus === 'RESULTS_PUBLISHED').length;
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">{t('summary', { total, completed, published })}</p>
            <FinishCard competition={competition} data={data} />
            <ul className="space-y-4">
              {data.categories.map((c) => (
                <li key={c.categoryId}>
                  <CategoryCard c={c} competition={competition} onChanged={invalidate} />
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </QueryState>
  );
}
