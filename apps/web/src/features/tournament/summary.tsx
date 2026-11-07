'use client';
// Регламент на афише (правки 05.11.2026): самое важное из положения — сроки, место, взвешивание, возрастные группы
// и весовые категории, документы, контакты.
import { categoryWeightLabel, type PublicCompetition, type PublicCompetitionCategory } from '@sde/contracts';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MarkdownLite } from '@/components/markdown-lite';
import { UnifiedRequirementsList } from '@/features/documents/unified-requirements';
import type { TournamentLabels } from './labels';
import { groupOf, posterDate } from './poster';

/** Регламент: самое важное из положения — сроки, место, взвешивание, участники и категории, документы. */
export function RegulationSummary({
  competition: c,
  labels,
}: {
  competition: PublicCompetition;
  labels: TournamentLabels;
}) {
  const t = useTranslations('tournamentPage.summary');
  const tr = useTranslations('tournaments');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const date = posterDate(c.startDate, c.endDate, locale);
  const groups = new Map<string, PublicCompetitionCategory[]>();
  for (const cat of c.categories) {
    const key = groupOf(cat, locale);
    groups.set(key, [...(groups.get(key) ?? []), cat]);
  }
  const rows: { icon: string; label: string; value: ReactNode }[] = [
    { icon: '📅', label: t('dates'), value: `${date.day} ${date.rest}` },
    {
      icon: '📍',
      label: t('venue'),
      value: c.venue
        ? [c.venue.name, c.venue.address, c.venue.city].filter(Boolean).join(', ')
        : tr('venueTbd'),
    },
    {
      icon: '📝',
      label: t('registration'),
      value: t('range', {
        from: labels.registrationFrom,
        to: labels.registrationTo,
      }),
    },
    {
      icon: '⚖️',
      label: t('weighIn'),
      value:
        labels.weighIn.length > 0
          ? labels.weighIn.map((w) => `${w.name}: ${t('range', { from: w.from, to: w.to })}`).join('; ')
          : t('weighInTbd'),
    },
    { icon: '🏛️', label: t('organizer'), value: c.organizerName },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-lg font-semibold">{t('title')}</h3>
        <dl className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3">
              <dt className="flex w-36 shrink-0 items-start gap-2 text-sm text-slate-600">
                <span aria-hidden="true">{r.icon}</span>
                {r.label}
              </dt>
              <dd className="text-sm text-slate-900">{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-lg font-semibold">{t('categories')}</h3>
        {groups.size === 0 ? (
          <p className="text-sm text-slate-600">{tr('categoriesTbd')}</p>
        ) : (
          <ul className="space-y-3">
            {[...groups.entries()].map(([g, cats]) => (
              <li key={g}>
                <p className="text-sm font-medium">{g}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {cats.map((x) => (
                    <li key={x.code} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-900">
                      {categoryWeightLabel(x.weight, lang)}
                      {x.participants > 0 ? (
                        <span className="text-slate-500"> · {x.participants}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Правки 07.11.2026, п. 13: требования допуска едины для всех турниров платформы. */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-lg font-semibold">{t('documents')}</h3>
        <UnifiedRequirementsList />
        {c.requirementsMd ? <MarkdownLite text={c.requirementsMd} className="mt-2" /> : null}
      </section>
      {c.descriptionMd ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-lg font-semibold">{tr('about')}</h3>
          <MarkdownLite text={c.descriptionMd} />
        </section>
      ) : null}
      {c.contacts && (c.contacts.name || c.contacts.email || c.contacts.phone) ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h3 className="mb-2 text-lg font-semibold">{tr('contacts')}</h3>
          {c.contacts.name ? <p>{c.contacts.name}</p> : null}
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
        </section>
      ) : null}
    </div>
  );
}
