'use client';
// «Настройки» кабинета (правки 28.10.2026): вкладка у каждой роли; сюда перенесены уведомления (лента, push, виды
// уведомлений) и тексты согласий — пользовательское соглашение, политика и согласие на обработку ПДн.
import { Card, CardTitle, PageHeader } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { NotificationsSection } from '@/features/notifications/list';

const LEGAL = [
  { href: '/terms', key: 'terms' },
  { href: '/privacy', key: 'privacy' },
  { href: '/personal-data-consent', key: 'consent' },
] as const;

function ConsentTexts() {
  const t = useTranslations();
  return (
    <section aria-labelledby="consents-title" id="consents" className="mt-10 scroll-mt-20">
      <h2 id="consents-title" className="mb-4 text-xl font-semibold text-slate-900">
        {t('mySettings.consentsTitle')}
      </h2>
      <Card>
        <CardTitle>{t('legal.nav')}</CardTitle>
        <p className="mb-3 text-sm text-slate-600">{t('mySettings.consentsHint')}</p>
        <ul className="space-y-1">
          {LEGAL.map((d) => (
            <li key={d.key}>
              <Link
                href={d.href}
                target="_blank"
                className="inline-flex min-h-11 items-center font-medium text-blue-700 hover:underline"
              >
                {t(`legal.${d.key}.title`)}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

export function SettingsPage() {
  const t = useTranslations('mySettings');
  return (
    <>
      <PageHeader title={t('title')} description={t('lead')} />
      <NotificationsSection />
      <ConsentTexts />
    </>
  );
}
