import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConsentTemplates } from '@/features/consent-templates';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('consentTemplates');
  return { title: t('title') };
}

export default function Page() {
  return <ConsentTemplates />;
}
