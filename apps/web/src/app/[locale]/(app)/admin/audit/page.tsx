import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditLog } from '@/features/audit';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit');
  return { title: t('title') };
}

export default function Page() {
  return <AuditLog />;
}
