'use client';
// Профиль: имя и язык, смена пароля, сеансы, двухфакторная аутентификация (API.md, 3.1–3.2). Показывается в личном
// кабинете (правки 27.10.2026: «Мой профиль» перенесён в «Личный кабинет»).
import type { DataEnvelope, Me, SessionDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { AvatarCard } from './avatar';
import { MyPersonCard } from './my-person';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { PasswordRequirements } from '@/components/password-requirements';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { describeUserAgent, formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';

type Notice = { tone: 'success' | 'danger'; text: string } | null;

function ProfileCard({ me }: { me: Me }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [locale, setLocale] = useState(me.locale);
  const [timezone, setTimezone] = useState(me.timezone ?? '');
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <Card>
      <CardTitle>{t('account.profile')}</CardTitle>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const res = await api<DataEnvelope<Me>>('/me', {
              method: 'PATCH',
              body: { displayName, locale, timezone: timezone || null },
            });
            queryClient.setQueryData(qk.me, res.data);
            setNotice({ tone: 'success', text: t('common.saved') });
          } catch (err) {
            setNotice({ tone: 'danger', text: errorMessage(err) });
          }
        }}
      >
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <Field id="displayName" label={t('account.displayName')}>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field id="locale" label={t('account.locale')}>
          <Select
            id="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value === 'en' ? 'en' : 'ru')}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field id="timezone" label={t('account.timezone')}>
          <Input
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Moscow"
          />
        </Field>
        <Button type="submit">{t('common.save')}</Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations('account');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <Card>
      <CardTitle>{t('password')}</CardTitle>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } });
            setCurrent('');
            setNext('');
            setNotice({ tone: 'success', text: t('passwordChanged') });
            await queryClient.invalidateQueries({ queryKey: qk.sessions });
          } catch (err) {
            setNotice({ tone: 'danger', text: errorMessage(err) });
          }
        }}
      >
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <Field id="currentPassword" label={t('currentPassword')}>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field id="newPassword" label={t('newPassword')}>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            aria-describedby="password-rules"
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <PasswordRequirements id="password-rules" value={newPassword} />
        <Button type="submit">{t('password')}</Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const t = useTranslations('account');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: qk.sessions,
    queryFn: async () => (await api<DataEnvelope<SessionDto[]>>('/auth/sessions')).data,
  });
  return (
    <Card>
      <CardTitle>{t('sessions')}</CardTitle>
      <QueryState isPending={sessions.isPending} error={sessions.error}>
        {() => (
          <ul className="divide-y divide-slate-100">
            {(sessions.data ?? []).map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium" title={s.userAgent ?? undefined}>
                    {describeUserAgent(s.userAgent)}
                  </p>
                  <p className="text-slate-600">
                    {s.ipMasked ?? '—'} · {t('lastUsed')}: {formatDateTime(s.lastUsedAt, locale)}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="info">{t('currentSession')}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await api(`/auth/sessions/${s.id}`, { method: 'DELETE' });
                      await queryClient.invalidateQueries({ queryKey: qk.sessions });
                    }}
                  >
                    {t('endSession')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

function TotpCard({ me }: { me: Me }) {
  const t = useTranslations('account');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: qk.me });
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err) });
    }
  };
  return (
    <Card>
      <CardTitle>{t('totp')}</CardTitle>
      <p className="mb-3">
        <Badge tone={me.totpEnabled ? 'success' : 'warning'}>
          {me.totpEnabled ? t('totpEnabled') : t('totpDisabled')}
        </Badge>
      </p>
      {notice ? (
        <Alert tone={notice.tone} className="mb-3">
          {notice.text}
        </Alert>
      ) : null}
      {recovery ? (
        <Alert tone="warning" title={t('recoveryTitle')} className="mb-3">
          <p>{t('recoveryBody')}</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {!me.totpEnabled && !secret ? (
        <Button
          onClick={() =>
            void run(async () => {
              const res = await api<DataEnvelope<{ otpauthUri: string }>>('/auth/totp/setup', {
                method: 'POST',
              });
              setSecret(new URL(res.data.otpauthUri).searchParams.get('secret'));
            })
          }
        >
          {t('totpSetup')}
        </Button>
      ) : null}
      {(secret || me.totpEnabled) && !recovery ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (me.totpEnabled) {
                await api('/auth/totp/disable', { method: 'POST', body: { code } });
              } else {
                const res = await api<DataEnvelope<{ recoveryCodes: string[] }>>('/auth/totp/enable', {
                  method: 'POST',
                  body: { code },
                });
                setRecovery(res.data.recoveryCodes);
                setSecret(null);
              }
              setCode('');
              await refresh();
            });
          }}
        >
          {secret ? (
            <>
              <p className="text-sm text-slate-600">{t('totpScan')}</p>
              <p className="text-sm">
                {t('totpKey')}:{' '}
                <code className="break-all rounded bg-slate-100 px-1 font-mono">{secret}</code>
              </p>
            </>
          ) : null}
          <Field id="totp-code" label={t('totpCode')}>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Button type="submit" variant={me.totpEnabled ? 'danger' : 'primary'}>
            {me.totpEnabled ? t('totpDisable') : t('totpEnable')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

/** Разделы профиля в личном кабинете. */
export function AccountSections({ me }: { me: Me }) {
  const t = useTranslations('account');
  return (
    <section aria-labelledby="account-title" className="mt-8">
      <h2 id="account-title" className="mb-4 text-xl font-semibold text-slate-900">
        {t('title')}
      </h2>
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCard me={me} />
        <AvatarCard me={me} />
        <TotpCard me={me} />
        <MyPersonCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </section>
  );
}
