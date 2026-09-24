import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Dashboard } from '@/features/dashboard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

export default function Page() {
  return <Dashboard />;
}
