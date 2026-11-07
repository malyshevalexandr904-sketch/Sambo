'use client';
// Поиск участников платформы по ФИО (правки 07.11.2026, п. 7): строка вверху кабинета, от двух букв — список с фото
// и ролями, выбор открывает страницу участника. Клавиши: ↑/↓ — выбор, Enter — открыть, Esc — закрыть.
import type { DataEnvelope, UserSearchItem } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { initialsOf } from '@/features/profile/profile-view';

export function PeopleSearch({ className }: { className?: string }) {
  const t = useTranslations('directory');
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    setOpen(false);
    setText('');
  }, [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const enabled = q.length >= 2;
  const found = useQuery({
    queryKey: ['people', 'search', q],
    queryFn: async () => (await api<DataEnvelope<UserSearchItem[]>>('/people/search', { query: { q } })).data,
    enabled,
    staleTime: 30_000,
  });
  const rows = found.data ?? [];
  useEffect(() => setActive(0), [q]);

  const go = (u: UserSearchItem): void => {
    setOpen(false);
    router.push(`/people/${u.userId}`);
  };
  const listId = `${id}-results`;

  return (
    <div ref={box} className={cn('relative w-full max-w-md', className)}>
      <label htmlFor={`${id}-q`} className="sr-only">
        {t('searchLabel')}
      </label>
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          id={`${id}-q`}
          type="search"
          role="combobox"
          aria-expanded={open && enabled}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={t('searchPlaceholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(rows.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && rows[active]) {
              e.preventDefault();
              go(rows[active]);
            }
          }}
          className="h-10 w-full rounded-full border border-slate-300 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>
      {open && enabled ? (
        <div
          id={listId}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {found.isPending ? (
            <p className="px-4 py-3 text-sm text-slate-500">{t('searching')}</p>
          ) : found.error ? (
            <p className="px-4 py-3 text-sm text-red-700">{t('searchFailed')}</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-600">{t('notFound')}</p>
          ) : (
            <ul role="listbox" aria-label={t('searchLabel')} className="max-h-96 overflow-y-auto py-1">
              {rows.map((u, i) => (
                <li key={u.userId} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(u)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-left',
                      i === active ? 'bg-blue-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-bold text-blue-800"
                    >
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(u.name)
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{u.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[...u.roles.map((r) => t(`roles.${r}`)), u.city].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
