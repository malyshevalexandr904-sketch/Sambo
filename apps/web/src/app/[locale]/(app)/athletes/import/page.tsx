import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AthletesImport } from '@/features/athletes/import';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('imports');
  return { title: t('title') };
}

export default function Page() {
  return <AthletesImport />;
}
