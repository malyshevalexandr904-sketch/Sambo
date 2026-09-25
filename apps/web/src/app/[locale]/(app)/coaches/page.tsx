import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Coaches } from '@/features/coaches';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coaches');
  return { title: t('title') };
}

export default function Page() {
  return <Coaches />;
}
