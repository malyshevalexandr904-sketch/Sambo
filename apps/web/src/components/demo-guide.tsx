'use client';
// Справка демо-режима (правки 28.10.2026): в демо-входе каждая вкладка вместо своего содержимого показывает, что
// в ней откроется после регистрации, и призыв зарегистрироваться — по обычному сценарию с главной (роль, учётная
// запись и пароль, анкета). Страница раздела при этом не монтируется и данных не запрашивает.
import type { CabinetRole } from '@sde/contracts';
import { Button, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRegisterFromDemo } from './demo-dialog';

const DEMO_ROLES = ['ORGANIZATION_HEAD', 'COACH', 'ATHLETE', 'REFEREE'] as const;
const MAX_FEATURES = 6;
const STEPS = ['role', 'account', 'profile', 'access'] as const;

/** Ключ справки по адресу вкладки и роли; у личного кабинета, турниров и спортсменов — свой текст для роли. */
export function demoGuideKey(pathname: string, role: CabinetRole | null): string {
  const r = DEMO_ROLES.find((x) => x === role) ?? 'ORGANIZATION_HEAD';
  const is = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  if (pathname === '/admin') return `cabinet.${r}`;
  if (is('/competitions')) return `competitions.${r}`;
  if (is('/athletes')) return r === 'COACH' ? 'athletes.COACH' : 'athletes.ORGANIZATION_HEAD';
  if (is('/coaches')) return 'coaches';
  if (is('/path-to-success')) return 'pathToSuccess';
  if (is('/settings') || is('/notifications') || is('/account')) return 'settings';
  if (is('/referee') || is('/protocols')) return 'refereeing';
  if (is('/applications')) return 'applications';
  if (is('/competition-requests')) return 'competitionRequests';
  if (is('/documents')) return 'documents';
  return 'generic';
}

export function DemoGuide({ pathname, role }: { pathname: string; role: CabinetRole | null }) {
  const t = useTranslations('demoGuide');
  const tr = useTranslations('cabinetRole.roles');
  const key = demoGuideKey(pathname, role);
  const base = `sections.${key}`;
  const features = Array.from({ length: MAX_FEATURES }, (_, i) => `${base}.f${i + 1}`).filter((k) =>
    t.has(`${k}.title`),
  );
  // Новая вкладка — снова первый пункт (key у панели перезапускает и анимацию появления).
  const [picked, setPicked] = useState<{ key: string; index: number }>({ key, index: 0 });
  const index = picked.key === key ? picked.index : 0;
  const current = features[index] ?? features[0]!;
  const register = useRegisterFromDemo();
  const [busy, setBusy] = useState(false);

  return (
    <div key={key} className="mx-auto max-w-4xl animate-fade-up">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-800">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-blue-200">{t('badge')}</span>
          {role ? <span>{t('viewingAs', { role: tr(role) })}</span> : null}
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">{t(`${base}.title`)}</h1>
        <p className="mt-2 max-w-2xl text-slate-700">{t(`${base}.lead`)}</p>
      </div>

      <section aria-labelledby="demo-guide-features" className="mt-6">
        <h2 id="demo-guide-features" className="text-lg font-semibold text-slate-900">
          {t('featuresTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('featuresHint')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="space-y-2" role="list">
            {features.map((f, i) => {
              const active = i === index;
              return (
                <li key={f}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPicked({ key, index: i })}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition',
                      active
                        ? 'border-blue-600 bg-white text-slate-900 shadow-sm ring-1 ring-blue-600'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition',
                        active ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {i + 1}
                    </span>
                    {t(`${f}.title`)}
                  </button>
                </li>
              );
            })}
          </ul>
          <div
            key={current}
            aria-live="polite"
            className="animate-fade-up rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('featureOf', { n: index + 1, total: features.length })}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{t(`${current}.title`)}</h3>
            <p className="mt-2 text-slate-700">{t(`${current}.text`)}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={index === 0}
                onClick={() => setPicked({ key, index: index - 1 })}
              >
                {t('prev')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={index === features.length - 1}
                onClick={() => setPicked({ key, index: index + 1 })}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="demo-guide-cta"
        className="mt-8 rounded-xl bg-blue-700 p-5 text-white shadow-md sm:p-6"
      >
        <h2 id="demo-guide-cta" className="text-xl font-bold">
          {t('ctaTitle')}
        </h2>
        <p className="mt-2 max-w-2xl text-white/85">{t('ctaText')}</p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className="animate-fade-up rounded-lg bg-white/10 p-3 text-sm ring-1 ring-white/20"
              style={{ animationDelay: `${150 + i * 120}ms` }}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide text-white/75">
                {t('step', { n: i + 1 })}
              </span>
              <span className="mt-1 block font-semibold">{t(`steps.${s}`)}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void register();
          }}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-white px-6 font-semibold text-blue-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow disabled:opacity-70 theme-light"
        >
          {t('ctaButton')}
        </button>
        <p className="mt-3 text-xs text-white/75">{t('privacyNote')}</p>
      </section>
    </div>
  );
}
