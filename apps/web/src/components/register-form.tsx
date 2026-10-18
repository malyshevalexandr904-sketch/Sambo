'use client';
// Регистрация (API.md, 3.1; 0.13.0): сначала роль, затем учётная запись; письмо подтверждения и его повторная
// отправка (она же — на экране входа, если почта не подтверждена).
import { zodResolver } from '@hookform/resolvers/zod';
import { isOnboardingRole, ONBOARDING_ROLES, type OnboardingRole, RegisterRequest } from '@sde/contracts';
import { Alert, Button, Card, Field, Input } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { applyFieldErrors, useErrorMessage, useFieldMessage } from '@/lib/errors';

/** Как на сервере (лимит `verifyResend`): не больше 3 писем за 15 минут на адрес. */
const RESEND_LIMIT = 3;
const RESEND_WINDOW_SECONDS = 15 * 60;

/**
 * Повторное письмо подтверждения (0.13.0): ответ сервера одинаковый для любого адреса; кнопка доступна раз в минуту,
 * после третьего письма — через 15 минут, как разрешает сервер (0.13.1).
 */
export function ResendVerification({ email, className }: { email: string; className?: string }) {
  const t = useTranslations('auth.resend');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  const resend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/verify-email/resend', {
        method: 'POST',
        body: { email, locale: locale === 'en' ? 'en' : 'ru' },
        noRefresh: true,
      });
      const count = sent + 1;
      setSent(count);
      setWait(count >= RESEND_LIMIT ? RESEND_WINDOW_SECONDS : 60);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') {
        // Ждать столько, сколько сказал сервер: лимит мог быть общий по адресу сети (несколько попыток входа в зале),
        // а не по письмам этого адреса (0.13.1).
        const retry = Number(e.details?.retryAfterSeconds);
        const seconds = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60;
        setError(seconds > 60 ? t('limited') : t('limitedShort'));
        setWait(seconds);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const minutes = Math.ceil(wait / 60);
  return (
    <div className={className}>
      <Button variant="secondary" loading={busy} disabled={wait > 0} onClick={() => void resend()}>
        {wait > 60 ? t('waitMinutes', { minutes }) : wait > 0 ? t('wait', { seconds: wait }) : t('button')}
      </Button>
      <p className="mt-2 text-sm text-slate-700" aria-live="polite">
        {error ?? (sent > 0 ? t('sent') : null)}
      </p>
    </div>
  );
}

/**
 * Регистрация (0.13.0): сначала роль, затем учётная запись. Роль запоминается и после подтверждения email сразу
 * открывается её анкета; права роль даёт только после одобрения заявки. Без роли — по приглашению (`next`) или для
 * представителя спортсмена (`role=none`): его связь с ребёнком оформляет тренер.
 */
export function RegisterForm() {
  const search = useSearchParams();
  const roleParam = search.get('role');
  const role = isOnboardingRole(roleParam) ? roleParam : null;
  if (!role && roleParam !== 'none' && search.get('next') === null) return <RegisterRoleStep />;
  return <RegisterAccountStep role={role} />;
}

function RegisterRoleStep() {
  const t = useTranslations('auth.register');
  const tRoles = useTranslations('cabinetRole.roles');
  return (
    <Card>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1 text-sm text-slate-600">{t('roleStep')}</p>
      <h2 className="mb-3 mt-5 text-base font-semibold text-slate-900">{t('whoAreYou')}</h2>
      <ul className="space-y-3">
        {ONBOARDING_ROLES.map((r) => (
          <li key={r}>
            <Link
              href={{ pathname: '/register', query: { role: r } }}
              className="block min-h-11 rounded-lg border border-slate-200 p-4 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <span className="block font-semibold text-slate-900">{tRoles(r)}</span>
              <span className="mt-1 block text-sm text-slate-600">{t(`roleHints.${r}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-slate-600">
        {t('guardianHint')}{' '}
        <Link
          href={{ pathname: '/register', query: { role: 'none' } }}
          className="text-blue-700 hover:underline"
        >
          {t('withoutRole')}
        </Link>
      </p>
      <p className="mt-4 text-sm">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-blue-700 hover:underline">
          {t('login')}
        </Link>
      </p>
    </Card>
  );
}

function RegisterAccountStep({ role }: { role: OnboardingRole | null }) {
  const t = useTranslations('auth');
  const tRoles = useTranslations('cabinetRole.roles');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof RegisterRequest>>({
    resolver: zodResolver(RegisterRequest),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      locale: locale === 'en' ? 'en' : 'ru',
      role: role ?? undefined,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: values, noRefresh: true });
      setSentTo(values.email);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['email', 'password', 'displayName', 'acceptTerms']))
        setError(errorMessage(e));
    }
  });

  if (sentTo) {
    return (
      <Card>
        <Alert tone="success" title={t('register.sentTitle')}>
          {t('register.sentBody', { email: sentTo })}
        </Alert>
        <p className="mt-4 text-sm text-slate-600">{t('register.notReceived')}</p>
        <ResendVerification email={sentTo} className="mt-3" />
      </Card>
    );
  }
  const { errors, isSubmitting } = form.formState;
  return (
    <Card>
      <h1 className="text-2xl font-semibold">{t('register.title')}</h1>
      {role ? (
        <p className="mb-6 mt-1 text-sm text-slate-600">
          {t('register.accountStep')} · {t('register.role')}: <strong>{tRoles(role)}</strong>{' '}
          <Link href="/register" className="text-blue-700 hover:underline">
            {t('register.changeRole')}
          </Link>
        </p>
      ) : (
        <div className="mb-6" />
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          id="displayName"
          label={t('register.displayName')}
          error={fieldMessage(errors.displayName?.message)}
        >
          <Input
            id="displayName"
            autoComplete="name"
            aria-invalid={!!errors.displayName}
            {...form.register('displayName')}
          />
        </Field>
        <Field id="email" label={t('email')} error={fieldMessage(errors.email?.message)}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field
          id="password"
          label={t('password')}
          hint={t('register.passwordHint')}
          error={fieldMessage(errors.password?.message)}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        <div>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5" {...form.register('acceptTerms')} />
            <span>{t('register.acceptTerms')}</span>
          </label>
          {errors.acceptTerms ? (
            <p role="alert" className="text-sm text-red-700">
              {fieldMessage(errors.acceptTerms.message)}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {t('register.submit')}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        {t('register.haveAccount')}{' '}
        <Link href="/login" className="text-blue-700 hover:underline">
          {t('login.submit')}
        </Link>
      </p>
    </Card>
  );
}
