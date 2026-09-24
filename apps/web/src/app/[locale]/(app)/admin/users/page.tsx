import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsersList } from '@/features/users';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('users');
  return { title: t('title') };
}

export default function Page() {
  return <UsersList />;
}
