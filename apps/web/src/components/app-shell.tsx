'use client';
// Адаптивный каркас кабинета и админ-панели (раздел 33 ТЗ; ARCHITECTURE.md, 23.3): боковое меню
// на широких экранах, выдвижное — на телефоне. Пункты меню — по правам выбранной роли кабинета (0.13.0; права
// приходят в /me уже для неё; скрытие — удобство, не защита). Переключатель роли — вверху меню.
import type { Me, PermissionCode } from '@sde/contracts';
import { Alert, Button, cn, Spinner } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { hasAnywhere, platformHas } from '@/lib/access';
import { setDemoMode } from '@/lib/demo';
import { closeLive } from '@/lib/live';
import { disablePushForLogout, syncPush } from '@/lib/push';
import { useMe } from '@/lib/queries';
import { ConsoleRoleBar, RoleChangedElsewhere, RoleSwitcher } from '@/features/cabinet-role';
import { Avatar } from '@/features/avatar';
import { NotificationBell } from '@/features/notifications/bell';
import { Brand } from './brand';
import { DemoGuide } from './demo-guide';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeSwitcher } from './theme-switcher';

export function hasPlatformPermission(me: Me | undefined, permission: PermissionCode): boolean {
  return platformHas(me, permission);
}

interface NavItem {
  href: string;
  label: string;
}

type Translate = ReturnType<typeof useTranslations>;

/**
 * Вкладки меню по выбранной роли (правки 28.10.2026): у каждой из четырёх ролей платформы — свой фиксированный набор,
 * одинаковый в обычном и демо-входе; уведомления и тексты согласий — в «Настройках». Прочие разделы роли (заявки,
 * судейство, проверка заявок и документов) открываются из личного кабинета. Администратор платформы сохраняет свои
 * разделы по правам.
 */
function navItems(t: Translate, user: Me): NavItem[] {
  const home = { href: '/admin', label: t('nav.dashboard') };
  const competitions = { href: '/competitions', label: t('nav.competitions') };
  const settings = { href: '/settings', label: t('nav.mySettings') };
  switch (user.activeRole) {
    case 'ORGANIZATION_HEAD':
      return [
        home,
        competitions,
        { href: '/coaches', label: t('nav.myCoaches') },
        { href: '/athletes', label: t('nav.myAthletes') },
        settings,
      ];
    case 'COACH':
      return [home, competitions, { href: '/athletes', label: t('nav.myAthletes') }, settings];
    case 'ATHLETE':
      return [home, competitions, { href: '/path-to-success', label: t('nav.pathToSuccess') }, settings];
    case 'GUARDIAN':
      return [home, competitions, { href: '/children', label: t('nav.children') }, settings];
    case 'ADMIN':
      return [home, competitions, ...adminItems(t, user), settings];
    default:
      return [home, competitions, settings];
  }
}

/** Разделы администратора платформы — по правам; в демо роли администратора нет. */
function adminItems(t: Translate, user: Me): NavItem[] {
  const items: (NavItem & { visible: boolean })[] = [
    {
      href: '/admin/organizations',
      label: t('nav.organizations'),
      visible: user.grants.platform.includes('SUPER_ADMIN'),
    },
    {
      href: '/competition-requests',
      label: t('nav.competitionRequests'),
      visible: hasPlatformPermission(user, 'competition.create_rated'),
    },
    {
      href: '/onboarding/review',
      label: t('nav.onboardingReview'),
      visible: hasAnywhere(user, 'onboarding.review'),
    },
    {
      href: '/admin/consent-templates',
      label: t('nav.consentTemplates'),
      visible: hasPlatformPermission(user, 'consent_template.manage'),
    },
    { href: '/admin/users', label: t('nav.users'), visible: hasPlatformPermission(user, 'user.view') },
    {
      href: '/admin/rating',
      label: t('nav.rating'),
      visible: hasPlatformPermission(user, 'competition.view_rating_audit'),
    },
    {
      href: '/admin/divisions',
      label: t('nav.divisions'),
      visible: hasPlatformPermission(user, 'division.manage'),
    },
    { href: '/admin/audit', label: t('nav.audit'), visible: hasPlatformPermission(user, 'audit.view') },
    {
      href: '/admin/settings',
      label: t('nav.settings'),
      visible: hasPlatformPermission(user, 'platform.settings.manage'),
    },
  ];
  return items.filter((i) => i.visible).map(({ href, label }) => ({ href, label }));
}

/**
 * `bare` — экран без меню (планшет ковра во весь экран): та же проверка входа, без бокового меню.
 */
export function AppShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const t = useTranslations();
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace({ pathname: '/login', query: { next: pathname } });
    }
  }, [me.error, pathname, router]);

  useEffect(() => setOpen(false), [pathname]);

  // Push этого устройства (Phase 8b): после нового входа — привязка к текущей сессии; ошибки не мешают работе.
  const userId = me.data?.id;
  useEffect(() => {
    if (userId) void syncPush(userId).catch(() => undefined);
  }, [userId]);

  if (me.isPending || (me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600" aria-live="polite">
        <Spinner className="mr-2" /> {t('common.loading')}
      </div>
    );
  }
  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert tone="danger" title={t('errors.UNKNOWN')}>
          <Button variant="secondary" className="mt-3" onClick={() => void me.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      </div>
    );
  }

  const user = me.data;
  // Демо-вход: действия перехватываются до запроса (lib/demo.ts).
  setDemoMode(user.demo);
  // Демо-вход (правки 28.10.2026): вкладка показывает справку о разделе и призыв зарегистрироваться, а не содержимое.
  const content = user.demo ? <DemoGuide pathname={pathname} role={user.activeRole} /> : children;
  if (bare) {
    return (
      <main id="main" className="min-h-screen bg-slate-100">
        <RoleChangedElsewhere userId={user.id} />
        <ConsoleRoleBar me={user} />
        {user.demo ? <div className="px-4 py-6">{content}</div> : content}
      </main>
    );
  }
  const nav = navItems(t, user);
  const isActive = (href: string): boolean =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);

  const logout = async (): Promise<void> => {
    try {
      // Push на это устройство после выхода не приходит: подписка снимается, пока сессия ещё действует.
      await disablePushForLogout(user.id);
      await api('/auth/logout', { method: 'POST', noRefresh: true });
    } finally {
      // Соединение живых данных — от имени вышедшего пользователя: закрыть, а не оставлять следующему.
      closeLive();
      queryClient.clear();
      router.replace('/login');
    }
  };

  return (
    <div className="min-h-screen lg:flex">
      <RoleChangedElsewhere userId={user.id} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        {t('common.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 lg:hidden print:hidden">
        <Link href="/admin" className="font-bold">
          <Brand />
        </Link>
        {user.activeRole ? (
          <span className="ml-3 hidden truncate text-sm text-slate-600 sm:inline">
            {t(`cabinetRole.roles.${user.activeRole}`)}
          </span>
        ) : null}
        <span className="ml-auto mr-1">
          <NotificationBell />
        </span>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('common.close') : t('common.menu')}
        </Button>
      </header>
      <aside
        id="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto overscroll-contain border-r border-slate-200 bg-white p-4 transition-transform lg:static lg:translate-x-0 lg:overflow-visible print:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 hidden items-center justify-between lg:flex">
          <Link href="/admin" className="text-lg font-bold">
            <Brand />
          </Link>
          <NotificationBell />
        </div>
        <RoleSwitcher me={user} />
        <nav aria-label={t('common.menu')}>
          <ul className="space-y-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center rounded-md px-3 text-sm font-medium',
                    isActive(item.href) ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SidebarFooter me={user} onLogout={() => void logout()} />
      </aside>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 print:p-0">
        {content}
      </main>
    </div>
  );
}

/** Низ меню: фото и имя (ссылка в личный кабинет), язык, тема, выход. */
function SidebarFooter({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
      <Link href="/admin" className="flex items-center gap-3 rounded-md hover:bg-slate-50">
        <Avatar me={me} />
        <span className="min-w-0">
          <span className="block font-medium text-slate-900">{me.displayName}</span>
          <span className="block truncate text-slate-500">{me.email}</span>
        </span>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </span>
        <Button variant="secondary" size="sm" onClick={onLogout}>
          {t('logout')}
        </Button>
      </div>
    </div>
  );
}
