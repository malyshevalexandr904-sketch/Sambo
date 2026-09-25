import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DocumentsQueue } from '@/features/documents/queue';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('documents');
  return { title: t('queueTitle') };
}

export default function Page() {
  return <DocumentsQueue />;
}
