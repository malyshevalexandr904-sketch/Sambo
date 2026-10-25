import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompetitionRequestsList } from '@/features/competition-requests/list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitionRequests');
  return { title: t('title') };
}

export default function Page() {
  return <CompetitionRequestsList />;
}
