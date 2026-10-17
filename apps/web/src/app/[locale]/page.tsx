import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import logo from '@/assets/logo.png';
import { HomeLoginAction } from '@/components/home-login-action';
import { Link } from '@/i18n/navigation';

/**
 * Первый экран (Phase 9a, 0.13.0): логотип и название, вход (для уже вошедшего — сразу кабинет), регистрация с
 * выбором роли и просмотр общедоступной части без входа.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const card = 'flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm';
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-4 py-12">
      {/* Белый фон картинки не вырезан (белые пояс и воротник): mix-blend-multiply прячет его на светлом фоне. */}
      <Image
        src={logo}
        alt=""
        priority
        unoptimized
        className="h-16 w-auto self-start mix-blend-multiply sm:h-20"
      />
      <h1 className="mt-4 text-4xl font-bold text-slate-900 sm:text-5xl">{t('title')}</h1>
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
          <Link
            href="/tournaments"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 font-medium text-slate-900 hover:bg-slate-50"
          >
            {t('continue')}
          </Link>
        </section>
      </div>
    </main>
  );
}
