import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AthleteDetail } from '@/features/athletes/detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('athletes');
  return { title: t('cardTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AthleteDetail id={id} />;
}
