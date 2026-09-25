'use client';
// Одно действие на экране: занятость, текст ошибки по коду, успешный результат.
import { useCallback, useState } from 'react';
import { useErrorMessage } from './errors';

export function useAction(): {
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
} {
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(errorMessage(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [errorMessage],
  );
  return { busy, error, setError, run };
}
