import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Confirmations } from '@/features/refereeing/officiating';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee');
  return { title: t('confirmations') };
}

export default async function Page({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  return <Confirmations competitionId={competitionId} />;
}
