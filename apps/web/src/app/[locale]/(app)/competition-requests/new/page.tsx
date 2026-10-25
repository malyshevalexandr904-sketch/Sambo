import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompetitionRequestForm } from '@/features/competition-requests/form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitionRequests');
  return { title: t('newTitle') };
}

export default function Page() {
  return <CompetitionRequestForm />;
}
