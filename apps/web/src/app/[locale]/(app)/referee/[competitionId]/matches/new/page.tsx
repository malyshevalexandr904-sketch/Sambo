import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ManualMatchForm } from '@/features/refereeing/manual-match';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee.manual');
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  return <ManualMatchForm competitionId={competitionId} />;
}
