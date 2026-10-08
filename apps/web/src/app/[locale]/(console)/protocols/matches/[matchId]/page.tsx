import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MatchProtocolPage } from '@/features/results/match-protocol';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protocols');
  return { title: t('matchTitlePlain') };
}

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <MatchProtocolPage matchId={matchId} />;
}
