'use client';
// «Настройки» кабинета (правки 28.10.2026; 05.11.2026, п. 7): все настройки в одном разделе, по вкладкам — профиль
// и оформление, безопасность и вход, уведомления, организации, справочники турниров, тексты согласий. Вкладка — в
// адресе (?tab=…), поэтому на неё можно дать ссылку (например, из личного кабинета). Вкладки, которых у роли нет,
// не показываются.
import type { Me } from '@sde/contracts';
import { Card, CardTitle, cn, PageHeader } from '@sde/ui';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { SectionLinks } from '@/components/section-links';
import { PasswordCard, ProfileCard, SessionsCard, TotpCard } from '@/features/account';
import { AvatarCard } from '@/features/avatar';
import { MyPersonCard } from '@/features/my-person';
import { RefereeExperienceCard } from '@/features/people/referee-experience';
import { NotificationsSection } from '@/features/notifications/list';
import { ProfilePanel } from '@/features/profile/profile-view';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useMe, useMyAthletes } from '@/lib/queries';
import { sectionLinks } from '@/lib/sections';
import { applyTheme, type Theme, themeOf } from '@/lib/theme';
import { OrganizationsList } from '@/features/profile/organizations';

const LEGAL = [
  { href: '/terms', key: 'terms' },
  { href: '/privacy', key: 'privacy' },
  { href: '/personal-data-consent', key: 'consent' },
] as const;

const TABS = ['profile', 'security', 'notifications', 'organizations', 'tournaments', 'consents'] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, IconName> = {
  profile: 'user',
  security: 'shield',
  notifications: 'bell',
  organizations: 'building',
  tournaments: 'book',
  consents: 'file',
};

function ConsentTexts() {
  const t = useTranslations();
  return (
    <Card>
      <CardTitle>{t('legal.nav')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('mySettings.consentsHint')}</p>
      <ul className="space-y-1">
        {LEGAL.map((d) => (
          <li key={d.key}>
            <Link
              href={d.href}
              target="_blank"
              className="inline-flex min-h-11 items-center gap-2 font-medium text-blue-700 hover:underline"
            >
              <Icon name="file" className="h-4 w-4" />
              {t(`legal.${d.key}.title`)}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Оформление: светлая или тёмная тема (то же, что переключатель внизу меню). */
function AppearanceCard() {
  const t = useTranslations('mySettings.appearance');
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => setTheme(themeOf(document.documentElement.dataset.theme)), []);
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('title')}>
        {(['light', 'dark'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={theme === v}
            onClick={() => {
              applyTheme(v);
              setTheme(v);
            }}
            className={cn(
              'flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border p-3 text-sm font-medium transition',
              theme === v
                ? 'border-blue-600 text-slate-900 ring-1 ring-blue-600'
                : 'border-slate-200 text-slate-700 hover:border-blue-300',
            )}
          >
            <span aria-hidden="true" className="text-2xl">
              {v === 'dark' ? '☾' : '☀'}
            </span>
            {t(v)}
          </button>
        ))}
      </div>
    </Card>
  );
}

function visibleTabs(me: Me, hasTournamentLinks: boolean): Tab[] {
  const showOrganizations =
    me.grants.organizations.length > 0 || me.activeRole === 'ORGANIZATION_HEAD' || me.activeRole === 'ADMIN';
  return TABS.filter(
    (tab) => (tab !== 'organizations' || showOrganizations) && (tab !== 'tournaments' || hasTournamentLinks),
  );
}

function TabBody({ tab, me }: { tab: Tab; me: Me }): ReactNode {
  const t = useTranslations('mySettings');
  switch (tab) {
    case 'profile':
      return (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="grid content-start gap-6">
            <AvatarCard me={me} />
            <AppearanceCard />
          </div>
          <ProfileCard me={me} />
          <MyPersonCard />
          <RefereeExperienceCard me={me} />
        </div>
      );
    case 'security':
      return (
        <div className="grid gap-6 xl:grid-cols-2">
          <PasswordCard />
          <TotpCard me={me} />
          <div className="xl:col-span-2">
            <SessionsCard />
          </div>
        </div>
      );
    case 'notifications':
      return <NotificationsSection />;
    case 'organizations':
      return (
        <ProfilePanel title={t('tabs.organizations')} icon="building">
          <OrganizationsList me={me} />
          <Link
            href="/admin/organizations/new"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50"
          >
            {t('createOrganization')}
          </Link>
        </ProfilePanel>
      );
    case 'tournaments':
      return (
        <>
          <p className="mb-4 text-sm text-slate-600">{t('tournamentsHint')}</p>
          <SectionLinks host="settings" />
        </>
      );
    case 'consents':
      return <ConsentTexts />;
  }
}

export function SettingsPage() {
  const t = useTranslations('mySettings');
  const { data: me } = useMe();
  const mine = useMyAthletes(!!me?.personId);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeRef = useRef<HTMLButtonElement>(null);
  const asked = search.get('tab');
  // Телефон: вкладки — лентой с прокруткой; выбранная должна быть видна.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [asked, me]);
  if (!me) return null;
  const tabs = visibleTabs(
    me,
    sectionLinks(me, mine.data).some((l) => l.host === 'settings'),
  );
  const tab: Tab = tabs.find((x) => x === asked) ?? 'profile';
  const select = (next: Tab): void => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  return (
    <>
      <PageHeader title={t('title')} description={t('lead')} />
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <div
          role="tablist"
          aria-label={t('title')}
          aria-orientation="vertical"
          className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:mb-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
        >
          {tabs.map((x) => {
            const active = x === tab;
            return (
              <button
                key={x}
                ref={active ? activeRef : undefined}
                type="button"
                role="tab"
                id={`settings-tab-${x}`}
                aria-selected={active}
                aria-controls="settings-panel"
                onClick={() => select(x)}
                className={cn(
                  'flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition',
                  active
                    ? 'bg-blue-700 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 lg:border-transparent lg:bg-transparent',
                )}
              >
                <Icon name={TAB_ICON[x]} className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">{t(`tabs.${x}`)}</span>
              </button>
            );
          })}
        </div>
        <div
          key={tab}
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="min-w-0 animate-fade-up"
        >
          <p className="mb-4 text-sm text-slate-600">{t(`tabHints.${tab}`)}</p>
          <TabBody tab={tab} me={me} />
        </div>
      </div>
    </>
  );
}
