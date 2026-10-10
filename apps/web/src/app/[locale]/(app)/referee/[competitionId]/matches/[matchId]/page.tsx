import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MatchHub } from '@/features/refereeing/match-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referee.hub');
  return { title: t('title') };
}

export default async function Page({
  params,
}: {
  params: Promise<{ competitionId: string; matchId: string }>;
}) {
  const { competitionId, matchId } = await params;
  return <MatchHub competitionId={competitionId} matchId={matchId} />;
}
