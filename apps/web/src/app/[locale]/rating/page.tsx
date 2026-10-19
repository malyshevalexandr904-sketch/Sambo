// Публичная таблица рейтинга (docs/RATING_ARCHITECTURE.md, 8): место, изменение места за сутки, уровень, рейтинг,
// схватки. Имя и ссылка на карточку — только при согласии спортсмена на распространение ПДн (ADR-15). Без входа.
import type { Page, PublicRankingRow } from '@sde/contracts';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicShell } from '@/components/public-shell';
import { RatedAthleteLabel, RankChange } from '@/components/rating-labels';
import { Link } from '@/i18n/navigation';
import { PublicApiError, publicApi } from '@/lib/public-api';

const FILTERS = ['gender', 'ageFrom', 'ageTo', 'regionId', 'clubId'] as const;
type Filters = Partial<Record<(typeof FILTERS)[number] | 'cursor', string>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'rating' });
  return { title: t('title'), description: t('lead') };
}

export default async function RatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('rating');
  const tg = await getTranslations('people.genders');
  const sp = await searchParams;
  const q: Filters = {};
  for (const k of [...FILTERS, 'cursor'] as const) {
    const v = sp[k];
    if (typeof v === 'string' && v.trim() !== '') q[k] = v.trim();
  }
  let page: Page<PublicRankingRow> | null = null;
  let invalid = false;
  try {
    page = await publicApi<Page<PublicRankingRow>>('/rankings', { ...q, limit: '50' });
  } catch (e) {
    invalid = e instanceof PublicApiError && e.status === 400;
  }
  const nextQuery = page?.page.nextCursor ? { ...q, cursor: page.page.nextCursor } : null;
  const filtered = FILTERS.some((k) => q[k]);
  return (
    <PublicShell>
      <h1 className="text-3xl font-bold text-slate-900">{t('title')}</h1>
      <p className="mt-2 text-slate-700">{t('lead')}</p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3" aria-label={t('filters')}>
        <label className="flex flex-col text-sm text-slate-700">
          {t('gender')}
          <select name="gender" defaultValue={q.gender ?? ''} className="mt-1 min-h-11 rounded border px-2">
            <option value="">{t('any')}</option>
            <option value="MALE">{tg('MALE')}</option>
            <option value="FEMALE">{tg('FEMALE')}</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          {t('ageFrom')}
          <input
            name="ageFrom"
            type="number"
            min={0}
            max={120}
            inputMode="numeric"
            defaultValue={q.ageFrom ?? ''}
            className="mt-1 min-h-11 w-24 rounded border px-2"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          {t('ageTo')}
          <input
            name="ageTo"
            type="number"
            min={0}
            max={120}
            inputMode="numeric"
            defaultValue={q.ageTo ?? ''}
            className="mt-1 min-h-11 w-24 rounded border px-2"
          />
        </label>
        {q.regionId ? <input type="hidden" name="regionId" value={q.regionId} /> : null}
        {q.clubId ? <input type="hidden" name="clubId" value={q.clubId} /> : null}
        <button type="submit" className="min-h-11 rounded bg-blue-700 px-4 font-medium text-white">
          {t('apply')}
        </button>
        {filtered ? (
          <Link href="/rating" className="inline-flex min-h-11 items-center text-blue-700 underline">
            {t('reset')}
          </Link>
        ) : null}
      </form>
      <p className="mt-2 text-sm text-slate-600">{t('filtersHint')}</p>

      {page === null ? (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
          {invalid ? t('invalidFilters') : t('unavailable')}
        </p>
      ) : page.data.length === 0 ? (
        <p className="mt-6 text-slate-600">{filtered ? t('emptyFiltered') : t('empty')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t('rank')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('athlete')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('rating')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('level')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('matches')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('winsLosses')}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((r, i) => (
                <tr key={r.athlete.publicId ?? `hidden-${r.rank}-${i}`} className="border-t border-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-semibold">{r.rank}</span> <RankChange change={r.rankChange} />
                  </td>
                  <td className="px-3 py-2">
                    <RatedAthleteLabel athlete={r.athlete} locale={locale} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.rating}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.level}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.ratedMatches}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.wins} / {r.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextQuery ? (
        <p className="mt-4">
          <Link href={{ pathname: '/rating', query: nextQuery }} className="text-blue-700 underline">
            {t('next')}
          </Link>
        </p>
      ) : null}
    </PublicShell>
  );
}
