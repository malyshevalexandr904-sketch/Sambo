import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RefereeHome } from '@/features/refereeing/officiating';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee');
  return { title: t('title') };
}

export default function Page() {
  return <RefereeHome />;
}
