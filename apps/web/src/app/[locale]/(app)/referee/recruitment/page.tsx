import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OpenRecruitments } from '@/features/refereeing/recruitment';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recruitment');
  return { title: t('openTitle') };
}

export default function Page() {
  return <OpenRecruitments />;
}
