import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">SAMBO</p>
      <h1 className="mt-2 text-4xl font-bold text-slate-900 sm:text-5xl">{t('title')}</h1>
      <p className="mt-4 text-lg text-slate-700">{t('lead')}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
        >
          {t('login')}
        </Link>
        <Link
          href="/register"
          className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-5 font-medium text-slate-900 hover:bg-slate-50"
        >
          {t('register')}
        </Link>
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center px-2 font-medium text-blue-700 underline-offset-4 hover:underline"
        >
          {t('openAdmin')}
        </Link>
      </div>
    </main>
  );
}
