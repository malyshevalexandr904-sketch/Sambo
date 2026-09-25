import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoriesEditor } from '@/features/categories';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  return { title: t('categoriesTitle') };
}

export default function Page() {
  return <CategoriesEditor />;
}
