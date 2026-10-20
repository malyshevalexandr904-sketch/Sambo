import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminAthleteRatingView } from '@/features/rating/admin-athlete-rating';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ratingAdmin');
  return { title: t('athleteTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminAthleteRatingView id={id} />;
}
