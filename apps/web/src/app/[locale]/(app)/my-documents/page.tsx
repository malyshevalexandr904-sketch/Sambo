import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyDocuments } from '@/features/documents/my-documents';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myDocuments');
  return { title: t('title') };
}

/** «Мои документы» спортсмена (правки 05.11.2026). */
export default function Page() {
  return <MyDocuments />;
}
