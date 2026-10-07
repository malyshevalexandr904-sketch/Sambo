import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MatTablet } from '@/features/refereeing/tablet';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee');
  return { title: t('openTablet') };
}

export default async function Page({
  params,
}: {
  params: Promise<{ competitionId: string; matId: string }>;
}) {
  const { matId } = await params;
  return <MatTablet matId={matId} />;
}
