import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryProtocolPage } from '@/features/results/category-protocol';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protocols');
  return { title: t('categoryTitle') };
}

export default async function Page({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  return <CategoryProtocolPage categoryId={categoryId} />;
}
