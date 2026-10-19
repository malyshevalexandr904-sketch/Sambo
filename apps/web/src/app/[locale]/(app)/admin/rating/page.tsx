import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminRating } from '@/features/rating/admin-rating';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ratingAdmin');
  return { title: t('title') };
}

export default function Page() {
  return <AdminRating />;
}
