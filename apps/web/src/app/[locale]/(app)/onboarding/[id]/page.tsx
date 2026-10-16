import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OnboardingRequestPage } from '@/features/onboarding/wizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('cabinet.title') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OnboardingRequestPage id={id} />;
}
