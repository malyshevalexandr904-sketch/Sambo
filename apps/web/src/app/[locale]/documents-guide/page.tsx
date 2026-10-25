// Инструкция «где взять документы» для анкеты роли — в открытом доступе: ссылка на неё — на шаге «Документы».
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PublicShell } from '@/components/public-shell';

const ITEMS = [
  'PASSPORT',
  'BIRTH_CERTIFICATE',
  'EGRUL_EXTRACT',
  'REFEREE_BOOK',
  'COACH_QUALIFICATION',
  'OTHER',
] as const;

const external = (href: string) =>
  function ExternalLink(chunks: ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
        {chunks}
      </a>
    );
  };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'documentsGuide' });
  return { title: t('title') };
}

export default async function DocumentsGuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('documentsGuide');
  return (
    <PublicShell>
      <article className="max-w-3xl text-slate-800">
        <h1 className="text-3xl font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-3">{t('lead')}</p>
        <ul className="mt-6 space-y-4">
          {ITEMS.map((code) => (
            <li key={code} id={code} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-slate-900">{t(`items.${code}.title`)}</h2>
              <p className="mt-2">
                <span className="font-medium">{t('who')}:</span> {t(`items.${code}.who`)}
              </p>
              <p className="mt-1">
                <span className="font-medium">{t('where')}:</span>{' '}
                {t.rich(`items.${code}.where`, {
                  gosuslugi: external('https://www.gosuslugi.ru'),
                  egrul: external('https://egrul.nalog.ru'),
                })}
              </p>
            </li>
          ))}
        </ul>
        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t('uploadTitle')}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>{t('upload.format')}</li>
          <li>{t('upload.photo')}</li>
          <li>{t('upload.privacy')}</li>
        </ul>
      </article>
    </PublicShell>
  );
}
