import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReviewDetail } from '@/features/onboarding/review';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('review.title') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewDetail id={id} />;
}
