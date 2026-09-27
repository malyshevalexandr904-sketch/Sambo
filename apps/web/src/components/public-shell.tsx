// Каркас публичных страниц витрины: шапка с названием и переключателем языка, без меню кабинета.
import type { PublicCompetitionSummary } from '@sde/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';

export async function PublicShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('tournaments');
  const tc = await getTranslations('common');
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/tournaments" className="font-semibold text-slate-900">
            {tc('appName')} · {t('title')}
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="inline-flex min-h-11 items-center text-blue-700 underline">
              {t('login')}
            </Link>
            <LocaleSwitcher />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}

/** Даты турнира — календарные в его часовом поясе (ADR-13): показываются как есть, без пересчёта. */
export function publicDates(start: string, end: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const s = new Date(`${start}T00:00:00Z`);
  return start === end ? fmt.format(s) : fmt.formatRange(s, new Date(`${end}T00:00:00Z`));
}

/** Момент в часовом поясе турнира с подписью пояса. */
export function publicInstant(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

export async function RegistrationBadge({ competition: c }: { competition: PublicCompetitionSummary }) {
  const t = await getTranslations('tournaments');
  if (c.status === 'CANCELLED')
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-sm text-red-900">
        <span aria-hidden="true">■</span>
        {t('cancelled')}
      </span>
    );
  if (c.registrationOpenNow)
    return (
      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-1 text-sm text-green-900">
        <span aria-hidden="true">●</span>
        {t('registrationOpen')}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-sm text-slate-800">
      <span aria-hidden="true">○</span>
      {t(`status.${c.status}`)}
    </span>
  );
}
