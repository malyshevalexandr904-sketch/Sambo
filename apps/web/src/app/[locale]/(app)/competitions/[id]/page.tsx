import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CompetitionPage } from '@/features/competitions/detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitions');
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CompetitionPage id={id} />
    </Suspense>
  );
}
