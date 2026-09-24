'use client';
// Действия по ссылке из письма: подтверждение email и принятие приглашения.
import { type DataEnvelope, type Me, type Membership } from '@sde/contracts';
import { Alert, Card, Spinner } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

export function VerifyEmail() {
  const t = useTranslations('auth.verify');
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Токен одноразовый: запрос отправляется ровно один раз даже в StrictMode.
    if (started.current) return;
    started.current = true;
    api<DataEnvelope<Me>>('/auth/verify-email', { method: 'POST', body: { token }, noRefresh: true })
      .then((res) => {
        queryClient.setQueryData(qk.me, res.data);
        router.replace('/admin');
      })
      .catch(() => setFailed(true));
  }, [token, router, queryClient]);

  return (
    <Card>
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      {failed ? (
        <Alert tone="danger">{t('failed')}</Alert>
      ) : (
        <p className="flex items-center gap-2 text-slate-700">
          <Spinner /> {t('verifying')}
        </p>
      )}
    </Card>
  );
}

export function AcceptInvite() {
  const t = useTranslations('auth.invite');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<
    | { kind: 'pending' }
    | { kind: 'done'; organizationId: string }
    | { kind: 'login' }
    | { kind: 'error'; message: string }
  >({
    kind: 'pending',
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<DataEnvelope<Membership>>('/invites/accept', { method: 'POST', body: { token } })
      .then((res) => {
        void queryClient.invalidateQueries({ queryKey: qk.me });
        setState({ kind: 'done', organizationId: res.data.organizationId });
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setState({ kind: 'login' });
        else setState({ kind: 'error', message: errorMessage(e) });
      });
  }, [token, queryClient, errorMessage]);

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
          <Link href={`/admin/organizations/${state.organizationId}`} className="font-medium underline">
            {t('goToOrganization')}
          </Link>
        </Alert>
      ) : null}
      {state.kind === 'login' ? (
        <Alert tone="info">
          {t('needLogin')}{' '}
          <Link href={{ pathname: '/login', query: { next } }} className="font-medium underline">
            →
          </Link>
        </Alert>
      ) : null}
      {state.kind === 'error' ? <Alert tone="danger">{state.message}</Alert> : null}
    </Card>
  );
}
