'use client';
// Кабинет спортсмена (docs/RATED_ONLY.md, 4, 5): дивизион по возрасту, текущий рейтинг и трекер Elo от схватки к
// схватке с последними схватками списком. Видят сам спортсмен, представитель и тренер.
import type { AthleteRatingProgress, DataEnvelope } from '@sde/contracts';
import { Badge, Card, CardTitle } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { ageRange } from '@/features/divisions/shared';
import { EloTracker } from '@/features/rating/elo-tracker';
import { api } from '@/lib/api';

/** Сколько последних схваток показывать списком под графиком. */
const RECENT = 5;

export function AthleteProgressCard({ athleteId, title }: { athleteId: string; title?: string }) {
  const t = useTranslations('athleteProgress');
  const query = useQuery({
    queryKey: ['athletes', athleteId, 'rating-progress'],
    queryFn: async () =>
      (await api<DataEnvelope<AthleteRatingProgress>>(`/athletes/${athleteId}/rating-progress`)).data,
  });
  return (
    <Card>
      <CardTitle>{title ?? t('title')}</CardTitle>
      <QueryState isPending={query.isPending} error={query.error}>
        {() => (query.data ? <Progress progress={query.data} /> : null)}
      </QueryState>
    </Card>
  );
}

function Progress({ progress: p }: { progress: AthleteRatingProgress }) {
  const t = useTranslations('athleteProgress');
  const td = useTranslations('divisions');
  const tr = useTranslations('rating');
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium' });
  const matches = p.bouts.filter((b) => b.kind === 'MATCH');
  const recent = [...p.bouts].reverse().slice(0, RECENT);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">{t('division')}:</span>
        {p.division ? (
          <Badge tone="info">
            <span aria-hidden="true">◆</span>
            {p.division.name} · {ageRange(td, p.division)}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <span aria-hidden="true">○</span>
            {t('noDivision')}
          </Badge>
        )}
        {p.division ? (
          <span className="text-xs text-slate-600">
            {t(p.division.agePolicy === 'BY_BIRTH_YEAR' ? 'ageByYear' : 'ageExact', { age: p.division.age })}
          </span>
        ) : null}
      </div>
      {p.rating ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              [tr('rating'), p.rating.rating],
              [tr('peakRating'), p.rating.peakRating],
              [tr('matches'), p.rating.ratedMatches],
              [tr('winsLosses'), `${p.rating.wins} / ${p.rating.losses}`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 p-3">
              <dt className="text-sm text-slate-600">{k}</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-600">{t('noRating')}</p>
      )}
      {matches.length > 0 ? (
        <section aria-labelledby={`elo-${p.athleteId}`}>
          <h3 id={`elo-${p.athleteId}`} className="font-semibold text-slate-900">
            {t('tracker')}
          </h3>
          <EloTracker bouts={p.bouts} locale={locale} />
          {p.truncated ? <p className="mt-1 text-xs text-slate-600">{t('truncated')}</p> : null}
          <h3 className="mt-4 font-semibold text-slate-900">{t('recent')}</h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {recent.map((b, i) => (
              <li key={`${b.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className="text-slate-600">{date.format(new Date(b.at))}</span>{' '}
                  {b.kind === 'CORRECTION'
                    ? tr('correction')
                    : [b.outcome ? tr(`outcomes.${b.outcome}`) : null, b.opponent?.name]
                        .filter(Boolean)
                        .join(' · ')}
                  {b.competition ? (
                    <span className="block text-xs text-slate-600">{b.competition.name}</span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {b.ratingAfter}{' '}
                  <span className={b.delta >= 0 ? 'text-green-800' : 'text-red-800'}>
                    ({b.delta > 0 ? '+' : ''}
                    {b.delta})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-slate-600">{t('noBouts')}</p>
      )}
    </div>
  );
}
