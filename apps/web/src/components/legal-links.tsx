// Ссылки на пользовательское соглашение, политику обработки ПДн и текст согласия — внизу публичных страниц (152-ФЗ, ч. 2 ст. 18.1: политика
// в открытом доступе).
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function LegalLinks({ className, tone }: { className?: string; tone?: 'onDark' }) {
  const t = useTranslations('legal');
  // На тёмном фоне первого экрана главной — светлые ссылки.
  const link = `inline-flex min-h-11 items-center underline ${tone === 'onDark' ? 'hover:text-white' : 'hover:text-slate-900'}`;
  return (
    <nav
      aria-label={t('nav')}
      className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${tone === 'onDark' ? 'text-white/70' : 'text-slate-600'} ${className ?? ''}`}
    >
      <Link href="/terms" className={link}>
        {t('terms.title')}
      </Link>
      <Link href="/privacy" className={link}>
        {t('privacy.title')}
      </Link>
      <Link href="/personal-data-consent" className={link}>
        {t('consent.title')}
      </Link>
    </nav>
  );
}
