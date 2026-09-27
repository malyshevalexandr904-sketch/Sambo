import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompetitionsList } from '@/features/competitions/list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitions');
  return { title: t('title') };
}

export default function Page() {
  return <CompetitionsList />;
}
