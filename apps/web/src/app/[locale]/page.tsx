import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoLoginAction } from '@/components/demo-login-action';
import { HomeAbout } from '@/components/home-about';
import { HomeLoginAction } from '@/components/home-login-action';
import { LegalLinks } from '@/components/legal-links';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Link } from '@/i18n/navigation';

/**
 * Первый экран (Phase 9a, 0.13.0): название, вход (для уже вошедшего — сразу кабинет), регистрация с
 * выбором роли и демо-вход: все роли и разделы для просмотра, без действий (правки 27.10.2026). Правки 28.10.2026:
 * переключатели языка и темы вверху, ниже первого экрана — секции «О платформе» с рейтинговой системой.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const card = 'flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm';
  return (
    <main>
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6">
        <div className="flex justify-end gap-2">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
        <div className="flex flex-1 flex-col justify-center py-8">
          <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 text-lg text-slate-700">{t('lead')}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <section className={card} aria-labelledby="home-login">
              <h2 id="home-login" className="text-lg font-semibold text-slate-900">
                {t('loginTitle')}
              </h2>
              <p className="mt-2 flex-1 text-sm text-slate-600">{t('loginHint')}</p>
              <HomeLoginAction />
            </section>
            <section className={card} aria-labelledby="home-register">
              <h2 id="home-register" className="text-lg font-semibold text-slate-900">
                {t('registerTitle')}
              </h2>
              <p className="mt-2 flex-1 text-sm text-slate-600">{t('registerHint')}</p>
              <Link
                href="/register"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 font-medium text-slate-900 hover:bg-slate-50"
              >
                {t('register')}
              </Link>
            </section>
            <section className={card} aria-labelledby="home-guest">
              <h2 id="home-guest" className="text-lg font-semibold text-slate-900">
                {t('guestTitle')}
              </h2>
              <p className="mt-2 flex-1 text-sm text-slate-600">{t('guestHint')}</p>
              <DemoLoginAction />
            </section>
          </div>
          <LegalLinks className="mt-8" />
        </div>
        <a
          href="#about"
          className="mx-auto inline-flex min-h-11 flex-col items-center text-sm font-medium text-slate-600 hover:text-blue-700"
        >
          {t('aboutLink')}
          <span aria-hidden="true" className="animate-float text-lg">
            ↓
          </span>
        </a>
      </div>
      <HomeAbout />
    </main>
  );
}
