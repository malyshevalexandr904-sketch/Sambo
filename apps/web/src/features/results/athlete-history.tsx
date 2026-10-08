'use client';
// «Результаты» в карточке спортсмена (план Phase 7b, §1): опубликованные места по турнирам — новые сверху — и
// итоги: турниры, схватки (победы и поражения), медали. Видят те же, кто видит карточку (клуб, тренер,
// представитель, сам спортсмен). Публичный профиль — Phase 9.
import type { AthleteHistoryDto, Medal } from '@sde/contracts';
import { Badge, Card, CardTitle } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { formatDates } from '@/features/competitions/shared';
import { pickName } from '@/lib/queries';
import { useAthleteHistory } from './api';
import { MedalBadge } from './shared';

const MEDALS: Medal[] = ['GOLD', 'SILVER', 'BRONZE'];

function Summary({ data }: { data: AthleteHistoryDto }) {
  const t = useTranslations('results.history');
  const s = data.summary;
  const items = [
    { label: t('competitions'), value: s.competitions },
    { label: t('matches'), value: s.matches },
    { label: t('wins'), value: s.wins },
    { label: t('losses'), value: s.losses },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-600">{i.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{i.value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex flex-wrap items-center gap-2 text-sm" aria-label={t('medals')}>
        <span className="text-slate-600">{t('medals')}:</span>
        {MEDALS.map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <MedalBadge medal={m} />
            <span className="font-semibold tabular-nums">× {s.medals[m]}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

export function AthleteHistoryPanel({ athleteId }: { athleteId: string }) {
  const t = useTranslations('results');
  const tLevel = useTranslations('competitions.levels');
  const locale = useLocale();
  const query = useAthleteHistory(athleteId);
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('history.title')}</CardTitle>
      <QueryState isPending={query.isPending} error={query.error}>
        {() => {
          const data = query.data as AthleteHistoryDto;
          if (data.results.length === 0)
            return <p className="text-sm text-slate-600">{t('history.empty')}</p>;
          return (
            <div className="space-y-4">
              <Summary data={data} />
              <ol className="divide-y divide-slate-100">
                {data.results.map((r) => (
                  <li
                    key={`${r.competitionId}-${pickName(r.categoryName, 'ru')}`}
                    className="flex items-start gap-3 py-3"
                  >
                    <span
                      className="w-12 shrink-0 text-center text-2xl font-bold tabular-nums"
                      aria-label={t('history.placeN', { place: r.place })}
                    >
                      {r.place}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.competitionName}</p>
                      <p className="text-sm text-slate-600">
                        {formatDates(r.startDate, r.endDate, locale)} · {tLevel(r.level)}
                      </p>
                      <p className="text-sm text-slate-700">
                        {pickName(r.categoryName, locale)}
                        {r.clubName ? ` · ${r.clubName}` : ''}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        {t('history.record', { wins: r.wins, losses: r.losses })}
                        {r.status === 'AMENDED' ? <Badge tone="warning">{t('history.amended')}</Badge> : null}
                      </p>
                    </div>
                    {r.medal ? <MedalBadge medal={r.medal} className="shrink-0" /> : null}
                  </li>
                ))}
              </ol>
            </div>
          );
        }}
      </QueryState>
    </Card>
  );
}
