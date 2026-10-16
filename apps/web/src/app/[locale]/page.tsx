import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Первый экран (Phase 9a): вход в существующий аккаунт, регистрация и просмотр общедоступной части без входа — с
 * понятным описанием ограничений гостевого режима.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const card = 'flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm';
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">SAMBO</p>
      <h1 className="mt-2 text-4xl font-bold text-slate-900 sm:text-5xl">{t('title')}</h1>
      <p className="mt-4 text-lg text-slate-700">{t('lead')}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <section className={card} aria-labelledby="home-login">
          <h2 id="home-login" className="text-lg font-semibold text-slate-900">
            {t('loginTitle')}
          </h2>
          <p className="mt-2 flex-1 text-sm text-slate-600">{t('loginHint')}</p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
          >
            {t('login')}
          </Link>
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
            {t('tournaments')}
          </Link>
        </section>
      </div>
      <Link
        href="/admin"
        className="mt-6 inline-flex min-h-11 items-center self-start px-2 font-medium text-blue-700 underline-offset-4 hover:underline"
      >
        {t('openAdmin')}
      </Link>
    </main>
  );
}
