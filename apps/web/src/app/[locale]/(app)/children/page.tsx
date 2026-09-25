import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyAthletes } from '@/features/children';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('children');
  return { title: t('title') };
}

export default function Page() {
  return <MyAthletes />;
}
