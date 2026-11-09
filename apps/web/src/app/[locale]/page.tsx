import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BrandWordmark } from '@/components/brand';
import { DemoLoginAction } from '@/components/demo-login-action';
import { HomeAbout } from '@/components/home-about';
import { HomeHeroBackdrop } from '@/components/home-hero-backdrop';
import { HomeLoginAction } from '@/components/home-login-action';
import { LegalLinks } from '@/components/legal-links';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Link } from '@/i18n/navigation';

/**
 * Первый экран (Phase 9a, 0.13.0): название, вход (для уже вошедшего — сразу кабинет), регистрация с
 * выбором роли и демо-вход: все роли и разделы для просмотра, без действий (правки 27.10.2026). Правки 28.10.2026:
 * переключатели языка и темы вверху, ниже первого экрана — секции «О платформе» с рейтинговой системой. Правки 31.10.2026:
 * фон первого экрана — видео зала с самбистами (на телефоне — неподвижный кадр), карточки входа — стеклянные.
 * Правки 04.11.2026: под названием — цитата Василия Шестакова с автором. Правки 05.11.2026: без надписи над названием,
 * цитата в одну строку, под автором — кратко, кто он; рядом с названием — анимированная эмблема из логотипа.
 * Правки 07.11.2026: без выбора языка, название — в фирменном начертании, под автором цитаты — только должность.
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
          {/* Правки 07.11.2026, п. 2: выбора языка больше нет, переключатель темы — в правом верхнем углу. */}
          <div className="flex justify-end">
            <ThemeSwitcher />
          </div>
          <div className="flex flex-1 flex-col justify-center py-10">
            {/* Правки 05.11.2026: эмблема-узел из логотипа рядом с названием. Появляется с поворотом, затем слегка
                «дышит» и по ней пробегает блик (globals.css, .hero-logo*); при «уменьшить движение» — неподвижна. */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div aria-hidden="true" className="hero-logo relative w-24 shrink-0 sm:w-40">
                <div className="hero-logo-float relative">
                  <img
                    src="/media/hero/logo-knot.webp"
                    alt=""
                    width={640}
                    height={381}
                    className="block h-auto w-full"
                  />
                  <span className="hero-logo-shine pointer-events-none absolute inset-0" />
                </div>
              </div>
              <h1
                className="animate-fade-up text-5xl font-extrabold tracking-tight text-white [text-shadow:0_2px_24px_rgb(0_0_0/0.45)] sm:text-7xl"
                style={{ animationDelay: '80ms' }}
              >
                {/* Правки 07.11.2026, п. 3: фирменное начертание надписи (components/brand.tsx). */}
                <BrandWordmark className="brand-word-on-dark flex-wrap" />
              </h1>
            </div>
            {/* Цвета самбо: красная и синяя куртки. */}
            <div aria-hidden="true" className="mt-5 flex h-1.5 w-40 overflow-hidden rounded-full">
              <span className="hero-bar flex-1 bg-red-600" />
              <span className="hero-bar flex-1 bg-blue-600" style={{ animationDelay: '250ms' }} />
            </div>
            {/* Цитата Василия Шестакова (правки 04.11.2026) — вместо прежней подписи «Окунись в мир самбо». */}
            {/* Правки 05.11.2026: цитата в одну строку (с планшета), под автором — кто он. */}
            <figure className="mt-5 animate-fade-up" style={{ animationDelay: '160ms' }}>
              <blockquote className="text-lg italic text-white/90 [text-shadow:0_1px_12px_rgb(0_0_0/0.5)] sm:whitespace-nowrap sm:text-[clamp(0.9rem,2.3vw,1.5rem)]">
                {t('lead')}
              </blockquote>
              <figcaption className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/70 [text-shadow:0_1px_12px_rgb(0_0_0/0.5)] sm:text-base">
                — {t('leadAuthor')}
                <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-white/60 sm:text-sm">
                  {t('leadAuthorAbout')}
                </span>
              </figcaption>
            </figure>
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
          {/* Правки 09.11.2026, п. 1: «О платформе» — заметная кнопка с пульсирующей обводкой и подписью, а не мелкая
              надпись. Стрелка внизу по-прежнему «плывёт», при «уменьшить движение» всё неподвижно. */}
          <a
            href="#about"
            className="about-cta group mx-auto mt-2 inline-flex min-h-14 items-center gap-3 rounded-full border-2 border-white/60 bg-white/15 py-2 pl-6 pr-3 text-white shadow-lg shadow-black/30 backdrop-blur-md transition hover:border-white hover:bg-white/25"
          >
            <span className="flex flex-col text-left leading-tight">
              <span className="text-lg font-bold sm:text-xl">{t('aboutLink')}</span>
              <span className="text-xs text-white/80 sm:text-sm">{t('aboutLinkHint')}</span>
            </span>
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-xl font-bold transition group-hover:bg-red-500"
            >
              <span className="animate-float">↓</span>
            </span>
          </a>
        </div>
      </div>
      <HomeAbout />
    </main>
  );
}
