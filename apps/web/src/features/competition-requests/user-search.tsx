'use client';
// Поиск ответственного за проведение среди зарегистрированных пользователей: вводите ФИО или почту — от трёх символов
// появляется список, выбор показывает карточку с кнопкой «Изменить». Почта в результатах скрыта наполовину.
import type { DataEnvelope, ResponsibleCandidateDto } from '@sde/contracts';
import { Button, Field, Input } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function ResponsibleUserSearch({
  value,
  onChange,
  error,
}: {
  value: ResponsibleCandidateDto | null;
  onChange: (user: ResponsibleCandidateDto | null) => void;
  error?: string;
}) {
  const t = useTranslations('competitionRequests');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const enabled = q.length >= 3 && !value;
  const found = useQuery({
    queryKey: ['competition-requests', 'responsible-candidates', q],
    queryFn: async () =>
      (
        await api<DataEnvelope<ResponsibleCandidateDto[]>>('/competition-requests/responsible-candidates', {
          query: { q },
        })
      ).data,
    enabled,
  });

  if (value)
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-600 bg-blue-50 p-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{value.displayName}</p>
          {value.maskedEmail ? <p className="text-sm text-slate-600">{value.maskedEmail}</p> : null}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange(null)}>
          {t('responsibleChange')}
        </Button>
      </div>
    );

  const rows = found.data ?? [];
  return (
    <div className="mt-4">
      <Field
        id="r-resp-search"
        label={t('responsibleSearch')}
        hint={t('responsibleSearchHint')}
        error={error}
      >
        <Input
          id="r-resp-search"
          type="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-controls="r-resp-results"
        />
      </Field>
      <div id="r-resp-results" aria-live="polite" className="mt-2">
        {!enabled ? null : found.isPending ? (
          <p className="text-sm text-slate-500">{t('responsibleSearching')}</p>
        ) : found.error ? (
          <p className="text-sm text-red-700">{t('responsibleSearchFailed')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">{t('responsibleNotFound')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200">
            {rows.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onChange(u)}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none"
                >
                  <span className="font-medium text-slate-900">{u.displayName}</span>
                  {u.maskedEmail ? <span className="text-sm text-slate-600">{u.maskedEmail}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
