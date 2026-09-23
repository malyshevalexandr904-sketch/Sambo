'use client';
// Системные настройки (API.md, 3.7): значения проверяются схемами на сервере.
import type { DataEnvelope, SystemSettingDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, PageHeader, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

function SettingRow({ setting }: { setting: SystemSettingDto }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(JSON.stringify(setting.value));
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
        ) : (
          <div className="space-y-2">
            <Textarea
              id={id}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
            <Button
              onClick={() => {
                try {
                  void save(JSON.parse(value) as unknown);
                } catch {
                  setState({ tone: 'danger', text: errorMessage(null) });
                }
              }}
            >
              {tc('save')}
            </Button>
          </div>
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

export function SystemSettings() {
  const t = useTranslations('settings');
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: async () => (await api<DataEnvelope<SystemSettingDto[]>>('/admin/settings')).data,
  });
  return (
    <>
      <PageHeader title={t('title')} />
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
