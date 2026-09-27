import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AcceptCompetitionInvite } from '@/components/token-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitions.invite');
  return { title: t('title'), robots: { index: false } };
}

export default function Page() {
  return (
    <Suspense>
      <AcceptCompetitionInvite />
    </Suspense>
  );
}
