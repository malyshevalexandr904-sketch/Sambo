// Публичная карточка рейтинга спортсмена (docs/RATING_ARCHITECTURE.md, 8): рейтинг, уровень, место, пик и история
// изменений (схватки и корректировки). Только для спортсменов, согласившихся на распространение ПДн (ADR-15),
// иначе — «не найдено».
import {
  type DataEnvelope,
  type Page,
  type PublicAthleteRating,
  type PublicRatedCompetition,
  type PublicRatingChart,
  type PublicRatingHistoryItem,
} from '@sde/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { PublicShell } from '@/components/public-shell';
import { RatedAthleteLabel, RankChange } from '@/components/rating-labels';
import { RatingChart } from '@/features/rating/rating-chart';
import { Link } from '@/i18n/navigation';
import { PublicApiError, publicApi } from '@/lib/public-api';

const PUBLIC_ID = /^[A-Za-z0-9_-]{6,32}$/;

const load = cache(async (publicId: string): Promise<PublicAthleteRating | null> => {
  if (!PUBLIC_ID.test(publicId)) return null;
  try {
    return (await publicApi<DataEnvelope<PublicAthleteRating>>(`/rankings/${publicId}`)).data;
  } catch (e) {
    if (e instanceof PublicApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}): Promise<Metadata> {
  const { locale, publicId } = await params;
  const a = await load(publicId).catch(() => null);
  if (!a?.athlete.name) return { robots: { index: false } };
  const t = await getTranslations({ locale, namespace: 'rating' });
  return { title: `${a.athlete.name} · ${t('title')}` };
}

export default async function AthleteRatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, publicId } = await params;
  setRequestLocale(locale);
  const a = await load(publicId);
  if (!a) notFound();
  const t = await getTranslations('rating');
  const cursor = (await searchParams).cursor;
  const [history, chart, competitions] = await Promise.all([
    publicApi<Page<PublicRatingHistoryItem>>(`/athletes/${publicId}/rating-history`, {
      limit: '50',
      cursor: typeof cursor === 'string' ? cursor : undefined,
    }).catch(() => null),
    // На следующих страницах истории график и турниры не нужны.
    typeof cursor === 'string'
      ? null
      : publicApi<DataEnvelope<PublicRatingChart>>(`/athletes/${publicId}/rating-chart`)
          .then((r) => r.data)
          .catch(() => null),
    typeof cursor === 'string'
      ? null
      : publicApi<DataEnvelope<PublicRatedCompetition[]>>(`/athletes/${publicId}/rated-competitions`)
          .then((r) => r.data)
          .catch(() => null),
  ]);
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const facts: [string, string | number][] = [
    [t('rating'), a.rating],
    [t('level'), a.level],
    [t('rank'), a.rank],
    [t('peakRating'), a.peakRating],
    [t('lowestRating'), a.lowestRating],
    [t('matches'), a.ratedMatches],
    [t('winsLosses'), `${a.wins} / ${a.losses}`],
    [t('winRate'), a.winRate === null ? '—' : `${new Intl.NumberFormat(locale).format(a.winRate)} %`],
  ];
  return (
    <PublicShell>
      <p className="text-sm">
        <Link href="/rating" className="text-blue-700 underline">
          ← {t('backToList')}
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{a.athlete.name}</h1>
      <p className="mt-1 text-slate-700">
        {[
          a.athlete.club,
          a.athlete.region ? (locale === 'en' ? a.athlete.region.en : a.athlete.region.ru) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <dt className="text-sm text-slate-600">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900">
              {v}
              {k === t('rank') ? (
                <>
                  {' '}
                  <RankChange change={a.rankChange} />
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {a.lastRatedMatchAt ? (
        <p className="mt-3 text-sm text-slate-600">
          {t('lastMatch', { date: date.format(new Date(a.lastRatedMatchAt)) })}
        </p>
      ) : null}

      {chart && chart.points.length > 1 ? (
        <section className="mt-8" aria-labelledby="rating-chart">
          <h2 id="rating-chart" className="text-xl font-semibold text-slate-900">
            {t('chart')}
          </h2>
          <RatingChart
            points={chart.points}
            locale={locale}
            label={t('chartLabel', {
              from: chart.points[0]!.rating,
              to: chart.points[chart.points.length - 1]!.rating,
              peak: Math.max(...chart.points.map((p) => p.rating)),
            })}
          />
          {chart.truncated ? <p className="mt-1 text-xs text-slate-600">{t('chartTruncated')}</p> : null}
        </section>
      ) : null}

      {competitions && competitions.length > 0 ? (
        <section className="mt-8" aria-labelledby="rated-competitions">
          <h2 id="rated-competitions" className="text-xl font-semibold text-slate-900">
            {t('competitions')}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('competitions')}</caption>
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t('competition')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('competitionRating')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('change')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('winsLosses')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((c) => (
                  <tr key={c.slug} className="border-t border-slate-200 align-top">
                    <td className="px-3 py-2">
                      <Link href={`/tournaments/${c.slug}`} className="text-blue-700 underline">
                        {c.name}
                      </Link>
                      <span className="block text-xs text-slate-600">
                        {date.format(new Date(`${c.startDate}T12:00:00Z`))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.ratingBefore} → {c.ratingAfter}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${c.delta > 0 ? 'text-green-800' : c.delta < 0 ? 'text-red-800' : ''}`}
                    >
                      {c.delta > 0 ? `+${c.delta}` : c.delta < 0 ? `−${-c.delta}` : '0'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.wins} / {c.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <h2 className="mt-8 text-xl font-semibold text-slate-900">{t('history')}</h2>
      {history === null ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
          {t('unavailable')}
        </p>
      ) : history.data.length === 0 ? (
        <p className="mt-3 text-slate-600">{t('historyEmpty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('history')}</caption>
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t('date')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('event')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('opponent')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('change')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('rating')}
                </th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((h, i) => (
                <tr key={`${h.at}-${i}`} className="border-t border-slate-200 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{date.format(new Date(h.at))}</td>
                  <td className="px-3 py-2">
                    {h.kind === 'CORRECTION' ? (
                      <span>{t('correction')}</span>
                    ) : (
                      <span className="flex flex-col">
                        {h.outcome ? <span>{t(`outcomes.${h.outcome}`)}</span> : null}
                        {h.competition ? (
                          <Link
                            href={`/tournaments/${h.competition.slug}`}
                            className="text-xs text-blue-700 underline"
                          >
                            {h.competition.name}
                          </Link>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.opponent ? (
                      <span className="flex flex-col">
                        <RatedAthleteLabel athlete={h.opponent} locale={locale} />
                        <span className="text-xs text-slate-600">
                          {t('opponentRating', { rating: h.opponent.ratingBefore })}
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${h.delta > 0 ? 'text-green-800' : h.delta < 0 ? 'text-red-800' : ''}`}
                  >
                    {h.delta > 0 ? `+${h.delta}` : h.delta < 0 ? `−${-h.delta}` : '0'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {h.ratingBefore} → {h.ratingAfter}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history?.page.nextCursor ? (
        <p className="mt-4">
          <Link
            href={{ pathname: `/rating/${publicId}`, query: { cursor: history.page.nextCursor } }}
            className="text-blue-700 underline"
          >
            {t('older')}
          </Link>
        </p>
      ) : null}
    </PublicShell>
  );
}
