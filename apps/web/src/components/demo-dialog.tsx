'use client';
// Окно демо-режима (правки 27.10.2026): появляется при любой попытке действия в демо-входе.
import { Button } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { DEMO_BLOCKED_EVENT, setDemoMode } from '@/lib/demo';
import { closeLive } from '@/lib/live';

/** Выход из демо и переход к регистрации — тот же сценарий, что кнопка «Зарегистрироваться» на главной. */
export function useRegisterFromDemo(): () => Promise<void> {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    try {
      await api('/auth/logout', { method: 'POST', noRefresh: true });
    } catch {
      // Сессия демо уже закончилась — регистрация всё равно открывается.
    } finally {
      setDemoMode(false);
      closeLive();
      queryClient.clear();
      router.push('/register');
    }
  };
}

export function DemoBlockedDialog() {
  const t = useTranslations('demo');
  const ref = useRef<HTMLDialogElement>(null);
  const registerFromDemo = useRegisterFromDemo();
  useEffect(() => {
    const open = (): void => {
      const d = ref.current;
      if (d && !d.open) d.showModal();
    };
    window.addEventListener(DEMO_BLOCKED_EVENT, open);
    return () => window.removeEventListener(DEMO_BLOCKED_EVENT, open);
  }, []);
  const register = async (): Promise<void> => {
    ref.current?.close();
    await registerFromDemo();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="demo-dialog-text"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
    >
      <p id="demo-dialog-text" className="text-lg font-semibold">
        {t('blocked')}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => ref.current?.close()}>
          {t('close')}
        </Button>
        <Button onClick={() => void register()}>{t('register')}</Button>
      </div>
    </dialog>
  );
}
