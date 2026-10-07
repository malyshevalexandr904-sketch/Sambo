'use client';
// Экран «Ковры» (план Phase 6, §6; Phase 7a, §1): текущая и до трёх следующих схваток ковра с реальным статусом
// (вызвана, идёт, пауза) и счётом, ожидаемое время следующих с учётом опоздания ковра, сыгранные схватки, ждущие
// подтверждения. Плановое время расписания не переписывается. Обновление каждые 15 секунд.
import type { MatQueueItemDto } from '@sde/contracts';
import { Badge, cn, EmptyState, Spinner } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { useCompetition } from '@/features/competitions/shared';
import { pickName } from '@/lib/queries';
import { timeInZone, useMatQueue, useRoundLabel } from './shared';

const STATUS_TONE = { IN_PROGRESS: 'success', PAUSED: 'warning', READY: 'info' } as const;

function MatchLine({ item, timezone, big }: { item: MatQueueItemDto; timezone: string; big?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('scheduling.queue');
  const tr = useTranslations('referee');
  const roundLabel = useRoundLabel();
  const late = Date.parse(item.expectedAt) - Date.parse(item.plannedAt) >= 60_000;
  const awaiting = item.status === 'FINISHED' && item.resultStatus === 'PROVISIONAL';
  const tone = awaiting ? 'warning' : STATUS_TONE[item.status as keyof typeof STATUS_TONE];
  const name = (side: 'RED' | 'BLUE'): string => {
    const p = side === 'RED' ? item.red : item.blue;
    return p.publicName ?? (p.bye ? t('bye') : '—');
  };
  return (
    <div
      className={
        big
          ? 'rounded-lg border border-slate-300 bg-white p-6'
          : 'rounded-md border border-slate-200 bg-white p-3'
      }
    >
      <p
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1',
          big ? 'text-lg text-slate-500' : 'text-sm text-slate-500',
        )}
      >
        <span>
          {timeInZone(item.plannedAt, timezone, locale)}
          {late && !awaiting && item.status !== 'IN_PROGRESS' && item.status !== 'PAUSED' ? (
            <span className="ml-1 font-medium text-amber-800">
              ({tr('expected', { time: timeInZone(item.expectedAt, timezone, locale) })})
            </span>
          ) : null}{' '}
          · №{item.matchNumber ?? '—'} · {pickName(item.categoryName, locale)} {roundLabel(item.roundLabel)}
        </span>
        {tone ? (
          <Badge tone={tone}>
            {awaiting ? tr('awaitingConfirmation') : tr(`matchStatuses.${item.status}`)}
          </Badge>
        ) : null}
      </p>
      <p className={big ? 'mt-2 text-4xl font-bold' : 'mt-1 text-xl font-semibold'}>
        <span className={item.winnerSide === 'RED' ? 'underline decoration-4 underline-offset-4' : undefined}>
          {name('RED')}
        </span>
        {item.score ? (
          <span className="mx-3 font-mono tabular-nums text-slate-700">
            {item.score.red}:{item.score.blue}
          </span>
        ) : (
          <span className="mx-3 text-slate-400">—</span>
        )}
        <span
          className={item.winnerSide === 'BLUE' ? 'underline decoration-4 underline-offset-4' : undefined}
        >
          {name('BLUE')}
        </span>
      </p>
      {item.method ? (
        <p className="mt-1 text-sm text-slate-600">
          {item.winnerSide ? `${tr(item.winnerSide === 'RED' ? 'red' : 'blue')}: ` : ''}
          {tr(`methods.${item.method}`)}
        </p>
      ) : null}
    </div>
  );
}

export function MatQueueView({ matId, timezone }: { matId: string; timezone: string }) {
  const t = useTranslations('scheduling.queue');
  const tr = useTranslations('referee');
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
              {data.delaySeconds >= 60 ? (
                <p
                  className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 font-medium text-amber-900"
                  role="status"
                >
                  {tr('delay', { minutes: Math.round(data.delaySeconds / 60) })}
                </p>
              ) : null}
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
              {data.awaitingConfirmation.length > 0 ? (
                <section>
                  <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
                    {tr('awaitingCount', { count: data.awaitingConfirmation.length })}
                  </h2>
                  <div className="space-y-2">
                    {data.awaitingConfirmation.map((item) => (
                      <MatchLine key={item.matchId} item={item} timezone={timezone} />
                    ))}
                  </div>
                </section>
              ) : null}
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
