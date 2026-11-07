import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserPage } from '@/features/people/user-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('pageTitle') };
}

/** Страница участника платформы (правки 07.11.2026, п. 8): открывается из поиска по ФИО. */
export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <UserPage userId={userId} />;
}
