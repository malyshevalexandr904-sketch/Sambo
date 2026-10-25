// Политика обработки персональных данных (152-ФЗ, ч. 2 ст. 18.1) — в открытом доступе, без входа.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicShell } from '@/components/public-shell';
import { LegalDocument } from '@/features/legal/legal-page';
import { operator } from '@/features/legal/operator';
import { privacyPolicy } from '@/features/legal/texts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('privacy.title') };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <PublicShell>
      <LegalDocument title={t('privacy.title')} sections={privacyPolicy(operator())} />
    </PublicShell>
  );
}
