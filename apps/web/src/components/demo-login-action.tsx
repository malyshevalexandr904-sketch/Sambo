'use client';
// Кнопка «Продолжить» карточки «Демо вход» (правки 27.10.2026): сессия демо-учётной записи и переход в личный кабинет.
import { Alert, Button } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { setDemoMode } from '@/lib/demo';
import { useErrorMessage } from '@/lib/errors';
import { closeLive } from '@/lib/live';

export function DemoLoginAction() {
  const t = useTranslations('home');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/demo', { method: 'POST', noRefresh: true });
      closeLive();
      queryClient.clear();
      setDemoMode(true);
      router.push('/admin');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <Button variant="secondary" className="mt-4" loading={busy} onClick={() => void start()}>
        {t('continue')}
      </Button>
    </>
  );
}
