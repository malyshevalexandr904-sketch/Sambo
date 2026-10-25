// Пользовательское соглашение — в открытом доступе, без входа: ссылка на него — у отметки при регистрации.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicShell } from '@/components/public-shell';
import { LegalDocument } from '@/features/legal/legal-page';
import { operator } from '@/features/legal/operator';
import { termsOfUse } from '@/features/legal/texts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('terms.title') };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <PublicShell>
      <LegalDocument title={t('terms.title')} sections={termsOfUse(operator())} />
    </PublicShell>
  );
}
