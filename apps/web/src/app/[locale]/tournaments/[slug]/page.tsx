// Публичная страница турнира (ADR-15; API.md, 5.9): положение, сроки регистрации, требования, категории с числом
// одобренных участников. Персональных данных здесь нет — только белый список полей публичного API.
import { categoryWeightLabel, type DataEnvelope, type PublicCompetition } from '@sde/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { MarkdownLite } from '@/components/markdown-lite';
import { PublicShell, publicDates, publicInstant, RegistrationBadge } from '@/components/public-shell';
import { Link } from '@/i18n/navigation';
import { PublicApiError, publicApi } from '@/lib/public-api';

const SLUG = /^[a-z0-9-]{3,80}$/;

const load = cache(async (slug: string): Promise<PublicCompetition | null> => {
  if (!SLUG.test(slug)) return null;
  try {
    return (await publicApi<DataEnvelope<PublicCompetition>>(`/competitions/${slug}`)).data;
  } catch (e) {
    if (e instanceof PublicApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await load(slug).catch(() => null);
  if (!c) return { robots: { index: false } };
  return { title: c.name, description: c.descriptionMd?.slice(0, 160) ?? undefined };
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const c = await load(slug);
  if (!c) notFound();
  const t = await getTranslations('tournaments');
  const tg = await getTranslations('people.genders');
  const name = (x: { ru: string; en: string }): string => (locale === 'en' ? x.en : x.ru);
  const lang = locale === 'en' ? 'en' : 'ru';
  const totalParticipants = c.categories.reduce((n, x) => n + x.participants, 0);
  return (
    <PublicShell>
      <p className="text-sm">
        <Link href="/tournaments" className="text-blue-700 underline">
          ← {t('backToList')}
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {c.logoUrl ? (
          <img src={c.logoUrl} alt="" width={72} height={72} className="h-18 w-18 rounded object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-slate-900">{c.name}</h1>
          <p className="mt-1 text-slate-700">
            {publicDates(c.startDate, c.endDate, locale)} · {name(c.discipline)} · {c.organizerName}
          </p>
          <div className="mt-2">
            <RegistrationBadge competition={c} />
          </div>
        </div>
      </div>

      {c.cancelReason ? (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
          {t('cancelledBecause', { reason: c.cancelReason })}
        </p>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label={t('keyFacts')}>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t('registration')}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {t('registrationWindow', {
              from: publicInstant(c.registrationStartsAt, c.timezone, locale),
              to: publicInstant(c.registrationEndsAt, c.timezone, locale),
            })}
          </p>
          {c.registrationOpenNow ? (
            <Link
              href="/login"
              className="mt-3 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
            >
              {t('applyCta')}
            </Link>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t('venue')}</h2>
          {c.venue ? (
            <p className="mt-1 text-sm text-slate-700">
              {[c.venue.name, c.venue.address, c.venue.city].filter(Boolean).join(', ')}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{t('venueTbd')}</p>
          )}
          {c.contacts && (c.contacts.name || c.contacts.email || c.contacts.phone) ? (
            <>
              <h2 className="mt-3 font-semibold">{t('contacts')}</h2>
              <p className="mt-1 text-sm text-slate-700">
                {c.contacts.name ? <span className="block">{c.contacts.name}</span> : null}
                {c.contacts.email ? (
                  <a className="block text-blue-700 underline" href={`mailto:${c.contacts.email}`}>
                    {c.contacts.email}
                  </a>
                ) : null}
                {c.contacts.phone ? (
                  <a className="block text-blue-700 underline" href={`tel:${c.contacts.phone}`}>
                    {c.contacts.phone}
                  </a>
                ) : null}
              </p>
            </>
          ) : null}
        </div>
      </section>

      {c.descriptionMd ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-xl font-semibold">{t('about')}</h2>
          <MarkdownLite text={c.descriptionMd} />
        </section>
      ) : null}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-xl font-semibold">{t('regulation')}</h2>
        {c.regulationUrl ? (
          <a
            href={c.regulationUrl}
            className="inline-flex min-h-11 items-center text-blue-700 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('regulationDownload')}
          </a>
        ) : (
          <p className="text-sm text-slate-600">{t('regulationTbd')}</p>
        )}
        {c.requirementsMd ? <MarkdownLite text={c.requirementsMd} className="mt-3" /> : null}
        {c.requirements.length > 0 ? (
          <>
            <h3 className="mt-4 font-semibold">{t('requirements')}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {c.requirements.map((r, i) => (
                <li key={i}>
                  {r.documentType ? name(r.documentType) : t(`requirementKinds.${r.kind}`)}
                  {r.categoryCode ? ` (${r.categoryCode})` : ''}
                  {r.mandatory ? '' : ` — ${t('optional')}`}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-xl font-semibold">
          {t('categories')}{' '}
          <span className="text-base font-normal text-slate-600">({c.categories.length})</span>
        </h2>
        {c.categories.length === 0 ? (
          <p className="text-sm text-slate-600">{t('categoriesTbd')}</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600">
              {t('participantsTotal', { count: totalParticipants })}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">{t('category')}</th>
                  <th className="py-2 text-right font-medium">{t('participants')}</th>
                </tr>
              </thead>
              <tbody>
                {c.categories.map((x) => (
                  <tr key={x.code} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <span className="block">{name(x.name)}</span>
                      <span className="text-xs text-slate-600">
                        {tg(x.gender)} · {categoryWeightLabel(x.weight, lang)}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{x.participants}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </PublicShell>
  );
}
