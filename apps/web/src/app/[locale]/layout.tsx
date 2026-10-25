import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { THEME_COOKIE, themeOf } from '@/lib/theme';
import { Providers } from '@/lib/providers';
import '../globals.css';

// CSP с nonce требует динамического рендеринга: nonce свой у каждого ответа (SECURITY.md, 6).
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { default: t('appName'), template: `%s — ${t('appName')}` },
    description: t('tagline'),
    // Сайт на экране «Домой» iPhone/iPad открывается как приложение — так на iOS работает Web Push (Phase 8b).
    appleWebApp: { capable: true, title: t('appName'), statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1d4ed8' };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Тема — из cookie, чтобы страница сразу пришла в выбранных цветах, без мигания и без инлайн-скрипта (CSP).
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
