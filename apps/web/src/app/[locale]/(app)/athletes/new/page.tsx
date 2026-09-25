import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AthleteCreate } from '@/features/athletes/create';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('athletes');
  return { title: t('createTitle') };
}

export default function Page() {
  return <AthleteCreate />;
}
