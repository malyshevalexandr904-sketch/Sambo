import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AthletesList } from '@/features/athletes/list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('athletes');
  return { title: t('title') };
}

export default function Page() {
  return <AthletesList />;
}
