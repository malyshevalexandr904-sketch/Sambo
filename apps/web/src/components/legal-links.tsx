// Ссылки на пользовательское соглашение, политику обработки ПДн и текст согласия — внизу публичных страниц (152-ФЗ, ч. 2 ст. 18.1: политика
// в открытом доступе).
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations('legal');
  return (
    <nav
      aria-label={t('nav')}
      className={`flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 ${className ?? ''}`}
    >
      <Link href="/terms" className="inline-flex min-h-11 items-center underline hover:text-slate-900">
        {t('terms.title')}
      </Link>
      <Link href="/privacy" className="inline-flex min-h-11 items-center underline hover:text-slate-900">
        {t('privacy.title')}
      </Link>
      <Link
        href="/personal-data-consent"
        className="inline-flex min-h-11 items-center underline hover:text-slate-900"
      >
        {t('consent.title')}
      </Link>
    </nav>
  );
}
