import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Invitations } from '@/features/people/invitations';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invitations');
  return { title: t('title') };
}

/** Приглашения в персонал турниров (правки 07.11.2026, п. 15). */
export default function Page() {
  return <Invitations />;
}
