import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompetitionCreateForm } from '@/features/competitions/create';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitions');
  return { title: t('createTitle') };
}

export default function Page() {
  return <CompetitionCreateForm />;
}
