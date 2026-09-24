import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrganizationDetail } from '@/features/organizations';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('organizations');
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizationDetail id={id} />;
}
