'use client';
// Судья на своей странице и на странице участника (правки 07.11.2026, п. 10): судейская категория, стаж работы,
// сколько турниров отсужено и рейтинг — среднее оценок организаторов (1–5 звёзд).
import type { RefereeStatsDto } from '@sde/contracts';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { pickName } from '@/lib/queries';
import { ProfilePanel } from '@/features/profile/profile-view';

/** Пять звёзд, закрашенных по среднему (до десятых). Подпись с числом — рядом текстом. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} viewBox="0 0 24 24" className="h-5 w-5">
            <defs>
              <linearGradient id={`star-${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
                <stop offset={`${fill * 100}%`} stopColor="#cbd5e1" />
              </linearGradient>
            </defs>
            <path
              d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
              fill={`url(#star-${i}-${Math.round(fill * 100)})`}
            />
          </svg>
        );
      })}
    </span>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-lg font-semibold text-slate-900">{children}</div>
    </div>
  );
}

export function RefereePanel({ stats, editable = false }: { stats: RefereeStatsDto; editable?: boolean }) {
  const t = useTranslations('directory.referee');
  const locale = useLocale();
  const r = stats.rating;
  return (
    <ProfilePanel title={t('title')} icon="whistle" delay={80} className="xl:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('category')}>
          {stats.categoryName ? pickName(stats.categoryName, locale) : t('noCategory')}
        </Tile>
        <Tile label={t('experience')}>
          {stats.experienceYears !== null ? (
            <>
              {t('years', { n: stats.experienceYears })}
              <span className="block text-xs font-normal text-slate-500">
                {t('since', { year: stats.sinceYear ?? '' })}
              </span>
            </>
          ) : (
            <span className="text-base font-normal text-slate-500">
              {t('noExperience')}
              {editable ? (
                <Link href="/settings?tab=profile" className="ml-1 text-blue-700 underline">
                  {t('setExperience')}
                </Link>
              ) : null}
            </span>
          )}
        </Tile>
        <Tile label={t('tournaments')}>{stats.tournaments}</Tile>
        <Tile label={t('rating')}>
          {r.average !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              <Stars value={r.average} />
              <span>{r.average.toLocaleString(locale, { minimumFractionDigits: 1 })}</span>
              <span className="text-xs font-normal text-slate-500">{t('ratings', { n: r.count })}</span>
            </span>
          ) : (
            <span className="text-base font-normal text-slate-500">{t('noRating')}</span>
          )}
        </Tile>
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('ratingHint')}</p>
    </ProfilePanel>
  );
}
