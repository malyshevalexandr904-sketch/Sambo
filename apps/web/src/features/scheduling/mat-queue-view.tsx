'use client';
// Экран «Ковры» (план Phase 6, §6): текущая и до трёх следующих схваток ковра, обновление каждые 15 секунд.
import type { ScheduleMatchDto } from '@sde/contracts';
import { Badge, EmptyState, Spinner } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { useCompetition } from '@/features/competitions/shared';
import { pickName } from '@/lib/queries';
import { timeInZone, useMatQueue, useRoundLabel } from './shared';

function MatchLine({ item, timezone, big }: { item: ScheduleMatchDto; timezone: string; big?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('scheduling.queue');
  const roundLabel = useRoundLabel();
  return (
    <div
      className={
        big
          ? 'rounded-lg border border-slate-300 bg-white p-6'
          : 'rounded-md border border-slate-200 bg-white p-3'
      }
    >
      <p className={big ? 'text-lg text-slate-500' : 'text-sm text-slate-500'}>
        {timeInZone(item.plannedAt, timezone, locale)} · №{item.matchNumber ?? '—'} ·{' '}
        {pickName(item.categoryName, locale)} {roundLabel(item.roundLabel)}
      </p>
      <p className={big ? 'mt-2 text-4xl font-bold' : 'mt-1 text-xl font-semibold'}>
        {item.red.publicName ?? (item.red.bye ? t('bye') : '—')}
        <span className="mx-3 text-slate-400">—</span>
        {item.blue.publicName ?? (item.blue.bye ? t('bye') : '—')}
      </p>
    </div>
  );
}

export function MatQueueView({ matId, timezone }: { matId: string; timezone: string }) {
  const t = useTranslations('scheduling.queue');
  const query = useMatQueue(matId);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <QueryState isPending={query.isPending} error={query.error}>
        {() => {
          const data = query.data;
          if (!data) return null;
          return (
            <>
              <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">
                  {t('matTitle', { number: data.matNumber })} {data.matName ?? ''}
                </h1>
                <Badge tone="info">
                  <Spinner className="h-3 w-3" /> {t('autoRefresh')}
                </Badge>
              </div>
              <section>
                <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
                  {t('current')}
                </h2>
                {data.current ? (
                  <MatchLine item={data.current} timezone={timezone} big />
                ) : (
                  <EmptyState title={t('noCurrent')} />
                )}
              </section>
              <section>
                <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
                  {t('next')}
                </h2>
                {data.next.length > 0 ? (
                  <div className="space-y-2">
                    {data.next.map((item) => (
                      <MatchLine key={item.matchId} item={item} timezone={timezone} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t('noNext')}</p>
                )}
              </section>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

/** Обёртка экрана «Ковры» для маршрута: подтягивает часовой пояс турнира. */
export function MatQueuePage({ competitionId, matId }: { competitionId: string; matId: string }) {
  const competitionQuery = useCompetition(competitionId);
  return (
    <QueryState isPending={competitionQuery.isPending} error={competitionQuery.error}>
      {() => {
        const competition = competitionQuery.data;
        if (!competition) return null;
        return <MatQueueView matId={matId} timezone={competition.timezone} />;
      }}
    </QueryState>
  );
}
