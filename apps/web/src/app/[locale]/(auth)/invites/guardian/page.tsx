import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AcceptGuardianInvite } from '@/features/guardian-invite';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('guardianInvite');
  return { title: t('title'), robots: { index: false } };
}

export default function Page() {
  return (
    <Suspense>
      <AcceptGuardianInvite />
    </Suspense>
  );
}
