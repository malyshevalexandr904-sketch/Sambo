// Текст согласия на обработку ПДн, которое пользователь даёт при регистрации (152-ФЗ, ст. 9). Без входа.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicShell } from '@/components/public-shell';
import { LegalDocument } from '@/features/legal/legal-page';
import { operator } from '@/features/legal/operator';
import { pdConsent } from '@/features/legal/texts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('consent.title') };
}

export default async function PersonalDataConsentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <PublicShell>
      <LegalDocument title={t('consent.title')} sections={pdConsent(operator())} />
    </PublicShell>
  );
}
