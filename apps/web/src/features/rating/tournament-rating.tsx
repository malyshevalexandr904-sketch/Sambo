// Изменения рейтинга на публичной странице рейтингового турнира (ТЗ 48; фаза 13): участники — рейтинг до турнира,
// после и изменение, последние посчитанные схватки — +XX / −XX Elo каждой стороны. Значения считает сервер (ТЗ 71).
// Обновляется сама после каждого расчёта (RatingLiveRefresh).
import type {
  DataEnvelope,
  Page,
  PublicCompetitionRatingSummary,
  PublicRatedMatch,
  PublicRatedMatchSide,
} from '@sde/contracts';
import { getTranslations } from 'next-intl/server';
import { RatedAthleteLabel } from '@/components/rating-labels';
import { PublicApiError, publicApi } from '@/lib/public-api';
import { RatingLiveRefresh } from './rating-live-refresh';

/** Последние схватки на странице турнира. */
const RECENT_MATCHES = 20;

async function load(
  slug: string,
): Promise<{ summary: PublicCompetitionRatingSummary; matches: PublicRatedMatch[] } | null> {
  const base = `/competitions/${encodeURIComponent(slug)}`;
  try {
    const [summary, matches] = await Promise.all([
      publicApi<DataEnvelope<PublicCompetitionRatingSummary>>(`${base}/rating-summary`),
      publicApi<Page<PublicRatedMatch>>(`${base}/rated-matches`, { limit: String(RECENT_MATCHES) }),
    ]);
    return { summary: summary.data, matches: matches.data };
  } catch (e) {
    if (e instanceof PublicApiError && e.status === 404) return null;
    throw e;
  }
}

function Delta({ value }: { value: number }) {
  return (
    <span
      className={`font-semibold tabular-nums ${value > 0 ? 'text-green-800' : value < 0 ? 'text-red-800' : ''}`}
    >
      {value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0'}
    </span>
  );
}

async function MatchSide({ side, locale }: { side: PublicRatedMatchSide; locale: string }) {
  const t = await getTranslations('tournaments.rating');
  return (
    <div className="flex items-start justify-between gap-3">
      <RatedAthleteLabel athlete={side.athlete} locale={locale} />
      <span className="shrink-0 text-right text-sm">
        <Delta value={side.delta} /> Elo
        <span className="block text-xs text-slate-600">
          {t('beforeAfter', { before: side.ratingBefore, after: side.ratingAfter })}
        </span>
      </span>
    </div>
  );
}

export async function TournamentRating({
  slug,
  locale,
  timeZone,
}: {
  slug: string;
  locale: string;
  /** Часовой пояс турнира: время схваток — местное. */
  timeZone: string;
}) {
  const data = await load(slug);
  if (!data) return null;
  const t = await getTranslations('tournaments.rating');
  const { summary, matches } = data;
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return (
    <section
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="rating-changes"
    >
      <RatingLiveRefresh slug={slug} />
      <h2 id="rating-changes" className="text-xl font-semibold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t('lead', { matches: summary.ratedMatches })}</p>
      {summary.athletes.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('athlete')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('before')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('after')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('change')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('winsLosses')}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.athletes.map((a, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <RatedAthleteLabel athlete={a.athlete} locale={locale} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.ratingBefore}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {a.ratingAfter}
                    <span className="block text-xs text-slate-600">
                      {t('level', { level: a.levelAfter })}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Delta value={a.delta} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {a.wins} / {a.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {matches.length > 0 ? (
        <>
          <h3 className="mt-5 font-semibold">{t('recentMatches')}</h3>
          <ol className="mt-2 space-y-2">
            {matches.map((m) => (
              <li key={m.matchPublicId} className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-xs text-slate-600">
                  {[
                    m.matchNumber ? t('match', { number: m.matchNumber }) : null,
                    locale === 'en' ? m.category.en : m.category.ru,
                    time.format(new Date(m.finishedAt)),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="space-y-2">
                  <MatchSide side={m.red} locale={locale} />
                  <MatchSide side={m.blue} locale={locale} />
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
