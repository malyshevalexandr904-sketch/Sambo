import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompetitionRequestDetail } from '@/features/competition-requests/detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('competitionRequests');
  return { title: t('cardTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompetitionRequestDetail id={id} />;
}
