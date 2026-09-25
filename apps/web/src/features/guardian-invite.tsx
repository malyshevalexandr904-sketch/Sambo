'use client';
// Принятие приглашения законного представителя (API.md, 4.2): аккаунт привязывается к записи представителя.
import { type DataEnvelope, type MyAthlete } from '@sde/contracts';
import { Alert, Card, Spinner } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

export function AcceptGuardianInvite() {
  const t = useTranslations('guardianInvite');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<
    | { kind: 'pending' }
    | { kind: 'done'; count: number }
    | { kind: 'login' }
    | { kind: 'error'; message: string }
  >({ kind: 'pending' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<DataEnvelope<MyAthlete[]>>('/guardian-invites/accept', { method: 'POST', body: { token } })
      .then((res) => {
        void queryClient.invalidateQueries({ queryKey: qk.me });
        void queryClient.invalidateQueries({ queryKey: qk.myAthletes });
        setState({ kind: 'done', count: res.data.length });
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setState({ kind: 'login' });
        else if (e instanceof ApiError && e.code === 'FORBIDDEN')
          setState({ kind: 'error', message: t('wrongAccount') });
        else setState({ kind: 'error', message: errorMessage(e) });
      });
  }, [token, queryClient, errorMessage, t]);

  const next =
    typeof window === 'undefined'
      ? ''
      : `${window.location.pathname.replace(/^\/(ru|en)/, '')}${window.location.search}`;
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      {state.kind === 'pending' ? (
        <p className="flex items-center gap-2">
          <Spinner /> {t('accepting')}
        </p>
      ) : null}
      {state.kind === 'done' ? (
        <Alert tone="success">
          {t('success')}{' '}
          <Link href="/children" className="font-medium underline">
            {t('goToChildren')}
          </Link>
        </Alert>
      ) : null}
      {state.kind === 'login' ? (
        <Alert tone="info">
          {t('needLogin')}{' '}
          <Link href={{ pathname: '/login', query: { next } }} className="font-medium underline">
            {t('login')}
          </Link>{' '}
          ·{' '}
          <Link href={{ pathname: '/register', query: { next } }} className="font-medium underline">
            {t('register')}
          </Link>
        </Alert>
      ) : null}
      {state.kind === 'error' ? <Alert tone="danger">{state.message}</Alert> : null}
    </Card>
  );
}
