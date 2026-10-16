import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OnboardingCabinet } from '@/features/onboarding/cabinet';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('cabinet.title') };
}

export default function Page() {
  return <OnboardingCabinet />;
}
