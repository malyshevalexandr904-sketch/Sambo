import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReviewQueue } from '@/features/onboarding/review';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('review.title') };
}

export default function Page() {
  return <ReviewQueue />;
}
