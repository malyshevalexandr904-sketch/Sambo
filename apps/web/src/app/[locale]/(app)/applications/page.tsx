import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { MyApplications } from '@/features/applications/list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('applications');
  return { title: t('myTitle') };
}

export default function Page() {
  return (
    <Suspense>
      <MyApplications />
    </Suspense>
  );
}
