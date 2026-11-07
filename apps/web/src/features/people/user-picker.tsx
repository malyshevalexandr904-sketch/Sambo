'use client';
// Выбор зарегистрированного участника по ФИО (правки 07.11.2026, п. 15): поиск от двух букв, выбранный — карточкой
// с кнопкой «Изменить». Используется для приглашения в персонал турнира.
import type { DataEnvelope, UserSearchItem } from '@sde/contracts';
import { Button, Field, Input } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function UserPicker({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: UserSearchItem | null;
  onChange: (u: UserSearchItem | null) => void;
}) {
  const t = useTranslations('directory');
  const tc = useTranslations('common');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const enabled = q.length >= 2 && !value;
  const found = useQuery({
    queryKey: ['people', 'search', q],
    queryFn: async () => (await api<DataEnvelope<UserSearchItem[]>>('/people/search', { query: { q } })).data,
    enabled,
  });
  const roles = (u: UserSearchItem): string =>
    [...u.roles.map((r) => t(`roles.${r}`)), u.city].filter(Boolean).join(' · ');

  if (value)
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-600 bg-blue-50 p-3">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{value.name}</p>
            <p className="text-sm text-slate-600">{roles(value)}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(null)}>
            {tc('edit')}
          </Button>
        </div>
      </div>
    );
  const rows = found.data ?? [];
  return (
    <div>
      <Field id={id} label={label} hint={t('searchPlaceholder')}>
        <Input
          id={id}
          type="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-controls={`${id}-results`}
        />
      </Field>
      <div id={`${id}-results`} aria-live="polite" className="mt-2">
        {!enabled ? null : found.isPending ? (
          <p className="text-sm text-slate-500">{t('searching')}</p>
        ) : found.error ? (
          <p className="text-sm text-red-700">{t('searchFailed')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">{t('notFound')}</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
            {rows.map((u) => (
              <li key={u.userId}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(u);
                    setText('');
                  }}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{u.name}</span>
                  <span className="text-sm text-slate-600">{roles(u)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
