import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { VerifyEmail } from '@/components/token-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verify');
  return { title: t('title'), robots: { index: false } };
}

export default function Page() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
