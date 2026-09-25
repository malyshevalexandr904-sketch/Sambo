'use client';
// Адаптивный каркас кабинета и админ-панели (раздел 33 ТЗ; ARCHITECTURE.md, 23.3): боковое меню
// на широких экранах, выдвижное — на телефоне. Пункты меню — по правам (скрытие — удобство, не защита).
import type { Me, PermissionCode } from '@sde/contracts';
import { Alert, Button, cn, Spinner } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { hasAnywhere, platformHas } from '@/lib/access';
import { useMe, useMyAthletes } from '@/lib/queries';
import { LocaleSwitcher } from './locale-switcher';

export function hasPlatformPermission(me: Me | undefined, permission: PermissionCode): boolean {
  return platformHas(me, permission);
}

interface NavItem {
  href: string;
  label: string;
  visible: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const me = useMe();
  const myAthletes = useMyAthletes(!!me.data?.personId);
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
  const nav: NavItem[] = [
    { href: '/admin', label: t('nav.dashboard'), visible: true },
    { href: '/athletes', label: t('nav.athletes'), visible: hasAnywhere(user, 'athlete.view') },
    { href: '/children', label: t('nav.children'), visible: (myAthletes.data?.length ?? 0) > 0 },
    { href: '/coaches', label: t('nav.coaches'), visible: hasAnywhere(user, 'coach.manage') },
    { href: '/documents', label: t('nav.documents'), visible: hasAnywhere(user, 'document.verify') },
    { href: '/admin/organizations', label: t('nav.organizations'), visible: true },
    { href: '/admin/referees', label: t('nav.referees'), visible: hasAnywhere(user, 'referee.manage') },
    { href: '/admin/categories', label: t('nav.categories'), visible: hasAnywhere(user, 'category.manage') },
    { href: '/admin/rulesets', label: t('nav.rulesets'), visible: hasAnywhere(user, 'ruleset.manage') },
    {
      href: '/admin/consent-templates',
      label: t('nav.consentTemplates'),
      visible: hasPlatformPermission(user, 'consent_template.manage'),
    },
    { href: '/admin/users', label: t('nav.users'), visible: hasPlatformPermission(user, 'user.view') },
    { href: '/admin/audit', label: t('nav.audit'), visible: hasPlatformPermission(user, 'audit.view') },
    {
      href: '/admin/settings',
      label: t('nav.settings'),
      visible: hasPlatformPermission(user, 'platform.settings.manage'),
    },
    { href: '/account', label: t('nav.account'), visible: true },
  ];
  const isActive = (href: string): boolean =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  const logout = async (): Promise<void> => {
    try {
      await api('/auth/logout', { method: 'POST', noRefresh: true });
    } finally {
      queryClient.clear();
      router.replace('/login');
    }
  };

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        {t('common.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
        <Link href="/admin" className="font-bold">
          SAMBO Digital
        </Link>
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
          'fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200 bg-white p-4 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link href="/admin" className="mb-6 hidden text-lg font-bold lg:block">
          SAMBO Digital
        </Link>
        <nav aria-label={t('common.menu')}>
          <ul className="space-y-1">
            {nav
              .filter((i) => i.visible)
              .map((item) => (
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
        <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
          <p className="font-medium text-slate-900">{user.displayName}</p>
          <p className="truncate text-slate-500">{user.email}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <LocaleSwitcher />
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              {t('common.logout')}
            </Button>
          </div>
        </div>
      </aside>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10">
        {children}
      </main>
    </div>
  );
}
