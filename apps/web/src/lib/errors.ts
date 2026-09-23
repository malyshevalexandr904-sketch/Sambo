'use client';
// Понятные сообщения по коду ошибки (ADR-16): текст — из словаря, а не из ответа сервера.
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        const key = t.has(error.code) ? error.code : 'UNKNOWN';
        return t(key, { traceId: error.traceId ?? '—' });
      }
      return t('UNKNOWN');
    },
    [t],
  );
}

/** Перевод кода ошибки поля (`invalid_email`, `password_leaked`, …). */
export function useFieldMessage(): (code: string | undefined) => string | undefined {
  const t = useTranslations('fields');
  return useCallback((code) => (code ? (t.has(code) ? t(code) : t('invalid')) : undefined), [t]);
}

/**
 * Ошибки полей с сервера показываются на тех же полях формы (ARCHITECTURE.md, 23.1).
 * Возвращает true, если хотя бы одно поле нашлось в форме.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  known: readonly string[],
): boolean {
  if (!(error instanceof ApiError) || error.fields.length === 0) return false;
  let applied = false;
  for (const f of error.fields) {
    if (known.includes(f.path)) {
      setError(f.path as Path<T>, { type: 'server', message: f.code });
      applied = true;
    }
  }
  return applied;
}
