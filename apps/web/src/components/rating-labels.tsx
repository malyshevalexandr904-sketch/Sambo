// Подписи публичных страниц рейтинга: спортсмен (имя — только при согласии, ADR-15) и изменение места.
import type { PublicRatedAthlete } from '@sde/contracts';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function RatedAthleteLabel({
  athlete: a,
  locale,
}: {
  athlete: PublicRatedAthlete;
  locale: string;
}) {
  const t = await getTranslations('rating');
  const where = [a.club, a.region ? (locale === 'en' ? a.region.en : a.region.ru) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="flex flex-col">
      {a.publicId && a.name ? (
        <Link href={`/rating/${a.publicId}`} className="font-medium text-blue-700 underline">
          {a.name}
        </Link>
      ) : (
        <span className="text-slate-600 italic">{t('hiddenAthlete')}</span>
      )}
      {where ? <span className="text-xs text-slate-600">{where}</span> : null}
    </span>
  );
}

/** ▲/▼ с числом мест; цвет дублируется знаком и текстом для скринридера. */
export async function RankChange({ change }: { change: number | null }) {
  const t = await getTranslations('rating');
  if (change === null || change === 0) return null;
  const up = change > 0;
  return (
    <span className={up ? 'text-green-800' : 'text-red-800'}>
      <span aria-hidden="true">
        {up ? '▲' : '▼'}
        {Math.abs(change)}
      </span>
      <span className="sr-only">{up ? t('rankUp', { n: change }) : t('rankDown', { n: -change })}</span>
    </span>
  );
}
