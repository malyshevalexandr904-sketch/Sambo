'use client';
// Переключатель светлой и тёмной темы — рядом с выбором языка.
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { applyTheme, type Theme, themeOf } from '@/lib/theme';

export function ThemeSwitcher() {
  const t = useTranslations('common.theme');
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => setTheme(themeOf(document.documentElement.dataset.theme)), []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={t(next === 'dark' ? 'toDark' : 'toLight')}
      title={t(next === 'dark' ? 'toDark' : 'toLight')}
      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-base text-slate-700 hover:bg-slate-50"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
