'use client';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="sr-only">{t('language')}</span>
      <select
        value={locale}
        onChange={(e) => {
          router.replace(`${pathname}${window.location.search}`, { locale: e.target.value });
        }}
        className="min-h-9 rounded-md border border-slate-300 bg-white px-2"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
