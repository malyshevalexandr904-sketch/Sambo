import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoLoginAction } from '@/components/demo-login-action';
import { HomeAbout } from '@/components/home-about';
import { HomeHeroBackdrop } from '@/components/home-hero-backdrop';
import { HomeLoginAction } from '@/components/home-login-action';
import { LegalLinks } from '@/components/legal-links';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Link } from '@/i18n/navigation';

/**
 * Первый экран (Phase 9a, 0.13.0): название, вход (для уже вошедшего — сразу кабинет), регистрация с
 * выбором роли и демо-вход: все роли и разделы для просмотра, без действий (правки 27.10.2026). Правки 28.10.2026:
 * переключатели языка и темы вверху, ниже первого экрана — секции «О платформе» с рейтинговой системой. Правки 31.10.2026:
 * фон первого экрана — видео зала с самбистами (на телефоне — неподвижный кадр), карточки входа — стеклянные.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const card =
    'flex animate-fade-up flex-col rounded-xl border border-white/15 bg-white/10 p-5 text-white shadow-lg shadow-black/20 backdrop-blur-md transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-white/15';
  return (
    <main>
      {/* Первый экран всегда в своих цветах (тёмный зал), в любой теме: .theme-light возвращает исходную палитру. */}
      <div className="theme-light relative isolate overflow-hidden bg-[#070d1a] text-white">
        <HomeHeroBackdrop />
        <div className="mx-auto flex min-h-[100svh] max-w-5xl flex-col px-4 py-6">
          <div className="flex justify-end gap-2">
            <LocaleSwitcher />
            <ThemeSwitcher />
          </div>
          <div className="flex flex-1 flex-col justify-center py-10">
            <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.25em] text-white/70 sm:text-sm">
              {t('eyebrow')}
            </p>
            <h1
              className="mt-3 animate-fade-up text-5xl font-extrabold tracking-tight text-white [text-shadow:0_2px_24px_rgb(0_0_0/0.45)] sm:text-7xl"
              style={{ animationDelay: '80ms' }}
            >
              {t('title')}
            </h1>
            {/* Цвета самбо: красная и синяя куртки. */}
            <div aria-hidden="true" className="mt-5 flex h-1.5 w-40 overflow-hidden rounded-full">
              <span className="hero-bar flex-1 bg-red-600" />
              <span className="hero-bar flex-1 bg-blue-600" style={{ animationDelay: '250ms' }} />
            </div>
            <p
              className="mt-5 max-w-xl animate-fade-up text-xl text-white/85 [text-shadow:0_1px_12px_rgb(0_0_0/0.5)] sm:text-2xl"
              style={{ animationDelay: '160ms' }}
            >
              {t('lead')}
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <section className={card} style={{ animationDelay: '260ms' }} aria-labelledby="home-login">
                <h2 id="home-login" className="text-lg font-semibold text-white">
                  {t('loginTitle')}
                </h2>
                <p className="mt-2 flex-1 text-sm text-white/75">{t('loginHint')}</p>
                <HomeLoginAction />
              </section>
              <section className={card} style={{ animationDelay: '340ms' }} aria-labelledby="home-register">
                <h2 id="home-register" className="text-lg font-semibold text-white">
                  {t('registerTitle')}
                </h2>
                <p className="mt-2 flex-1 text-sm text-white/75">{t('registerHint')}</p>
                <Link
                  href="/register"
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-red-600 px-5 font-medium text-white shadow-sm transition hover:bg-red-700"
                >
                  {t('register')}
                </Link>
              </section>
              <section className={card} style={{ animationDelay: '420ms' }} aria-labelledby="home-guest">
                <h2 id="home-guest" className="text-lg font-semibold text-white">
                  {t('guestTitle')}
                </h2>
                <p className="mt-2 flex-1 text-sm text-white/75">{t('guestHint')}</p>
                <DemoLoginAction />
              </section>
            </div>
            <LegalLinks className="mt-8" tone="onDark" />
          </div>
          <a
            href="#about"
            className="mx-auto inline-flex min-h-11 flex-col items-center text-sm font-medium text-white/75 hover:text-white"
          >
            {t('aboutLink')}
            <span aria-hidden="true" className="animate-float text-lg">
              ↓
            </span>
          </a>
        </div>
      </div>
      <HomeAbout />
    </main>
  );
}
