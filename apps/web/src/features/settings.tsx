'use client';
// Системные настройки (API.md, 3.7): значения проверяются схемами на сервере.
// У известных настроек — обычные поля; JSON — только для настроек без своего редактора.
import type { DataEnvelope, EmailDeliveryStatus, SystemSettingDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

type Save = (value: unknown) => Promise<void>;

function EmailEditor({ id, setting, save }: { id: string; setting: SystemSettingDto; save: Save }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [value, setValue] = useState(typeof setting.value === 'string' ? setting.value : '');
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(value.trim() === '' ? null : value.trim());
      }}
    >
      <Input id={id} type="email" value={value} onChange={(e) => setValue(e.target.value)} />
      <p className="text-xs text-slate-500">{t('emptyMeansNone')}</p>
      <Button type="submit">{tc('save')}</Button>
    </form>
  );
}

function BannerEditor({ id, setting, save }: { id: string; setting: SystemSettingDto; save: Save }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const current = (setting.value ?? null) as { ru: string; en: string } | null;
  const [ru, setRu] = useState(current?.ru ?? '');
  const [en, setEn] = useState(current?.en ?? '');
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save(ru.trim() === '' && en.trim() === '' ? null : { ru: ru.trim(), en: en.trim() });
      }}
    >
      <Field id={id} label={t('bannerRu')}>
        <Textarea id={id} value={ru} maxLength={500} onChange={(e) => setRu(e.target.value)} />
      </Field>
      <Field id={`${id}-en`} label={t('bannerEn')}>
        <Textarea id={`${id}-en`} value={en} maxLength={500} onChange={(e) => setEn(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">{t('bannerHint')}</p>
      <Button type="submit">{tc('save')}</Button>
    </form>
  );
}

function JsonEditor({ id, setting, save }: { id: string; setting: SystemSettingDto; save: Save }) {
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(JSON.stringify(setting.value));
  const [invalid, setInvalid] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Textarea id={id} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />
      {invalid ? <Alert tone="danger">{invalid}</Alert> : null}
      <Button
        onClick={() => {
          setInvalid(null);
          try {
            void save(JSON.parse(value) as unknown);
          } catch {
            setInvalid(errorMessage(null));
          }
        }}
      >
        {tc('save')}
      </Button>
    </div>
  );
}

function SettingRow({ setting }: { setting: SystemSettingDto }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const id = `setting-${setting.key}`;
  const labelKey = `keys.${setting.key.replaceAll('.', '_')}`;
  const save = async (raw: unknown): Promise<void> => {
    setState(null);
    try {
      await api(`/admin/settings/${setting.key}`, { method: 'PUT', body: { value: raw } });
      await queryClient.invalidateQueries({ queryKey: qk.settings });
      setState({ tone: 'success', text: tc('saved') });
    } catch (e) {
      setState({ tone: 'danger', text: errorMessage(e) });
    }
  };
  const isBoolean = typeof setting.value === 'boolean';
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {t.has(labelKey) ? t(labelKey) : setting.key}
        </label>
        {setting.isDefault ? <Badge>{t('default')}</Badge> : null}
      </div>
      <code className="text-xs text-slate-500">{setting.key}</code>
      <div className="mt-3">
        {isBoolean ? (
          <label className="flex min-h-11 items-center gap-3">
            <input
              id={id}
              type="checkbox"
              className="h-5 w-5"
              checked={setting.value === true}
              onChange={(e) => void save(e.target.checked)}
            />
            {setting.value === true ? tc('yes') : tc('no')}
          </label>
        ) : setting.key === 'support.contactEmail' ? (
          <EmailEditor id={id} setting={setting} save={save} />
        ) : setting.key === 'ui.maintenanceBanner' ? (
          <BannerEditor id={id} setting={setting} save={save} />
        ) : (
          <JsonEditor id={id} setting={setting} save={save} />
        )}
      </div>
      {state ? (
        <Alert tone={state.tone} className="mt-3">
          {state.text}
        </Alert>
      ) : null}
    </Card>
  );
}

/**
 * Письма не покидают сервер (0.13.0): по умолчанию установка пишет их в почтовый ящик для разработки Mailpit —
 * подтверждение email и уведомления по почте пользователям не дойдут, пока не подключена почта домена.
 */
function EmailDeliveryWarning() {
  const t = useTranslations('settings.email');
  const status = useQuery({
    queryKey: ['admin', 'settings', 'email-delivery'],
    queryFn: async () =>
      (await api<DataEnvelope<EmailDeliveryStatus>>('/admin/settings/email-delivery')).data,
  });
  if (!status.data) return null;
  if (!status.data.internal)
    return (
      <p className="mb-4 text-sm text-slate-600">
        {t('ok', { from: status.data.from, host: status.data.host ?? '—' })}
      </p>
    );
  return (
    <Alert tone="warning" title={t('internalTitle')} className="mb-6">
      {t('internal')}
    </Alert>
  );
}

export function SystemSettings() {
  const t = useTranslations('settings');
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: async () => (await api<DataEnvelope<SystemSettingDto[]>>('/admin/settings')).data,
  });
  return (
    <>
      <PageHeader title={t('title')} />
      <EmailDeliveryWarning />
      <QueryState isPending={settings.isPending} error={settings.error}>
        {() => (
          <div className="grid gap-4 xl:grid-cols-2">
            {(settings.data ?? []).map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}
