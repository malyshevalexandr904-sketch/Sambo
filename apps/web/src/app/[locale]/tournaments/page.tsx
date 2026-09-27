// Публичный список турниров (ADR-15): только опубликованные турниры и белый список полей. Без входа.
import type { Page, PublicCompetitionSummary } from '@sde/contracts';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicShell, publicDates, RegistrationBadge } from '@/components/public-shell';
import { Link } from '@/i18n/navigation';
import { publicApi } from '@/lib/public-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tournaments' });
  return { title: t('title'), description: t('lead') };
}

export default async function TournamentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tournaments');
  let rows: PublicCompetitionSummary[] = [];
  let failed = false;
  try {
    rows = (await publicApi<Page<PublicCompetitionSummary>>('/competitions', { limit: '50' })).data;
  } catch {
    failed = true;
  }
  return (
    <PublicShell>
      <h1 className="text-3xl font-bold text-slate-900">{t('title')}</h1>
      <p className="mt-2 text-slate-700">{t('lead')}</p>
      {failed ? (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
          {t('unavailable')}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {rows.map((c) => (
            <li key={c.slug} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <Link href={`/tournaments/${c.slug}`} className="text-lg font-semibold text-blue-700 underline">
                {c.name}
              </Link>
              <p className="mt-1 text-sm text-slate-700">{publicDates(c.startDate, c.endDate, locale)}</p>
              <p className="text-sm text-slate-600">
                {[
                  c.city,
                  c.regionName ? (locale === 'en' ? c.regionName.en : c.regionName.ru) : null,
                  c.organizerName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-2">
                <RegistrationBadge competition={c} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
