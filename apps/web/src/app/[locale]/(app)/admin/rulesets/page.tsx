import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RuleSets } from '@/features/rulesets';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rulesets');
  return { title: t('title') };
}

export default function Page() {
  return <RuleSets />;
}
