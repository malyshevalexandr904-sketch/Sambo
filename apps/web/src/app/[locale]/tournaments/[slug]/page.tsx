// Публичная страница турнира по стадиям проведения (правки 05.11.2026): разделы «Афиша», «Положение»,
// «Регистрация», «Турнирные сетки», «Прямая трансляция», «Медиа» — набор зависит от стадии (contracts
// `publicSectionsOf`). Персональных данных нет: имена участников в сетках — только с согласием на распространение.
import {
  type CompetitionMediaDto,
  type DataEnvelope,
  type PublicBracketsDto,
  type PublicCompetition,
  type PublicLiveDto,
  publicSectionsOf,
} from '@sde/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { PublicShell } from '@/components/public-shell';
import { TournamentRating } from '@/features/rating/tournament-rating';
import { TournamentPage as TournamentView } from '@/features/tournament/tournament-page';
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

/** Дополнительные разделы: сбой одного не мешает остальной странице. */
async function optional<T>(path: string): Promise<T | null> {
  try {
    return (await publicApi<DataEnvelope<T>>(path)).data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await load(slug).catch(() => null);
  if (!c) return { robots: { index: false } };
  const description = c.descriptionMd?.replace(/[*_`#]/g, '').slice(0, 160) ?? undefined;
  return { title: c.name, description, openGraph: { title: c.name, description, type: 'website' } };
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
  const sections = publicSectionsOf(c.status);
  const base = `/competitions/${slug}`;
  const [brackets, live, media] = await Promise.all([
    sections.includes('brackets') ? optional<PublicBracketsDto>(`${base}/brackets`) : null,
    sections.includes('live') ? optional<PublicLiveDto>(`${base}/live`) : null,
    sections.includes('media') ? optional<CompetitionMediaDto[]>(`${base}/media`) : null,
  ]);
  return (
    <PublicShell>
      <TournamentView competition={c} brackets={brackets} live={live} media={media} />
      {c.ratingPublic ? <TournamentRating slug={c.slug} locale={locale} timeZone={c.timezone} /> : null}
    </PublicShell>
  );
}
