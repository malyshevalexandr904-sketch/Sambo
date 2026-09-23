'use client';
// Формы входа, регистрации и восстановления пароля (API.md, 3.1). Схемы — из packages/contracts.
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type DataEnvelope,
  ForgotPasswordRequest,
  LoginRequest,
  type Me,
  Password,
  RegisterRequest,
} from '@sde/contracts';
import { Alert, Button, Card, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { applyFieldErrors, useErrorMessage, useFieldMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

/** Переход после входа — только на внутренний путь (защита от открытого редиректа). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/admin';
}

export function LoginForm() {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof LoginRequest>>({
    resolver: zodResolver(LoginRequest),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<DataEnvelope<Me>>('/auth/login', {
        method: 'POST',
        body: values,
        noRefresh: true,
      });
      queryClient.setQueryData(qk.me, res.data);
      router.replace(safeNext(search.get('next')));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') {
        setNeedTotp(true);
        return;
      }
      if (!applyFieldErrors(e, form.setError, ['email', 'password', 'totpCode'])) setError(errorMessage(e));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">{t('login.title')}</h1>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="email" label={t('email')} error={fieldMessage(errors.email?.message)}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field id="password" label={t('password')} error={fieldMessage(errors.password?.message)}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        {needTotp ? (
          <Field
            id="totpCode"
            label={t('login.totpCode')}
            hint={t('login.totpHint')}
            error={fieldMessage(errors.totpCode?.message)}
          >
            <Input
              id="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              {...form.register('totpCode')}
            />
          </Field>
        ) : null}
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {t('login.submit')}
        </Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm sm:flex-row sm:justify-between">
        <Link href="/forgot-password" className="text-blue-700 hover:underline">
          {t('login.forgot')}
        </Link>
        <span>
          {t('login.noAccount')}{' '}
          <Link href="/register" className="text-blue-700 hover:underline">
            {t('login.register')}
          </Link>
        </span>
      </div>
    </Card>
  );
}

export function RegisterForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof RegisterRequest>>({
    resolver: zodResolver(RegisterRequest),
    defaultValues: { email: '', password: '', displayName: '', locale: locale === 'en' ? 'en' : 'ru' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: values, noRefresh: true });
      setSent(true);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['email', 'password', 'displayName', 'acceptTerms']))
        setError(errorMessage(e));
    }
  });

  if (sent) {
    return (
      <Card>
        <Alert tone="success" title={t('register.sentTitle')}>
          {t('register.sentBody')}
        </Alert>
      </Card>
    );
  }
  const { errors, isSubmitting } = form.formState;
  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">{t('register.title')}</h1>
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

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof ForgotPasswordRequest>>({
    resolver: zodResolver(ForgotPasswordRequest),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: values, noRefresh: true });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-semibold">{t('forgot.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('forgot.body')}</p>
      {sent ? (
        <Alert tone="success">{t('forgot.sent')}</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="email" label={t('email')} error={fieldMessage(form.formState.errors.email?.message)}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {t('forgot.submit')}
          </Button>
        </form>
      )}
    </Card>
  );
}

const ResetForm = z.object({ newPassword: Password });

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof ResetForm>>({
    resolver: zodResolver(ResetForm),
    defaultValues: { newPassword: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: { token, newPassword: values.newPassword },
        noRefresh: true,
      });
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['newPassword'])) setError(errorMessage(e));
    }
  });
  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">{t('reset.title')}</h1>
      {done ? (
        <Alert tone="success">
          {t('reset.done')}{' '}
          <Link href="/login" className="font-medium underline">
            {t('login.submit')}
          </Link>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field
            id="newPassword"
            label={t('reset.newPassword')}
            hint={t('register.passwordHint')}
            error={fieldMessage(form.formState.errors.newPassword?.message)}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </Card>
  );
}
