import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrganizationsList } from '@/features/organizations';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('organizations');
  return { title: t('title') };
}

export default function Page() {
  return <OrganizationsList />;
}
