import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ApplicationPage } from '@/features/applications/detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('applications');
  return { title: t('cardTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationPage id={id} />;
}
