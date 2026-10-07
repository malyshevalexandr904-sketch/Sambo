import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OfficiatingMats } from '@/features/refereeing/officiating';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee');
  return { title: t('mats') };
}

export default async function Page({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  return <OfficiatingMats competitionId={competitionId} />;
}
