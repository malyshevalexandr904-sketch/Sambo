import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MatScoreboard } from '@/features/live/mat-scoreboard';

// Табло ковра для зала (Phase 8a): открывается по ссылке без входа, только публичные данные; в поиск не попадает.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('scoreboard');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatScoreboard matId={id} />;
}
