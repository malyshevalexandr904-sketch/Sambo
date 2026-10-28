import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { SettingsPage } from '@/features/my-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mySettings');
  return { title: t('title') };
}

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
