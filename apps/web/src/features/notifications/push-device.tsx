'use client';
// Push на этом устройстве и список устройств (Phase 8b; API.md, 5.8): включение с разрешением браузера, подсказки,
// когда push недоступен (браузер, iPhone вне экрана «Домой», запрет в настройках), удаление устройств.
import type { DataEnvelope, PushDeviceDto } from '@sde/contracts';
import { Alert, Button, Card, CardTitle } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  deviceName,
  disablePush,
  enabledHere,
  enablePush,
  pushConfig,
  PushPermissionError,
  pushSupport,
  type PushSupport,
} from '@/lib/push';
import { useMe } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

const DEVICES = ['me', 'push', 'devices'] as const;

function Devices() {
  const t = useTranslations('notifications.push');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const action = useAction();
  const devices = useQuery({
    queryKey: DEVICES,
    queryFn: async () => (await api<DataEnvelope<PushDeviceDto[]>>('/me/push/subscriptions')).data,
  });
  const rows = devices.data ?? [];
  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold">{t('devices')}</h3>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">{devices.isPending ? '…' : t('noDevices')}</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100">
          {rows.map((d) => {
            const name = deviceName(d.userAgent);
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{name ? t('device', name) : t('unknownDevice')}</p>
                  <p className="text-xs text-slate-500">
                    {t('added', { date: formatDateTime(d.createdAt, locale) })}
                    {d.lastUsedAt
                      ? ` · ${t('lastUsed', { date: formatDateTime(d.lastUsedAt, locale) })}`
                      : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`/me/push/subscriptions/${d.id}`, { method: 'DELETE' });
                      await queryClient.invalidateQueries({ queryKey: DEVICES });
                    })
                  }
                >
                  {t('remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PushDeviceCard() {
  const t = useTranslations('notifications.push');
  const me = useMe();
  const queryClient = useQueryClient();
  const action = useAction();
  const userId = me.data?.id;
  // Поддержка и разрешение известны только в браузере: до монтирования — как «не поддерживается», без мигания.
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const config = useQuery({ queryKey: ['me', 'push', 'config'], queryFn: pushConfig, staleTime: 5 * 60_000 });
  const here = useQuery({
    queryKey: ['me', 'push', 'here', userId],
    queryFn: () => enabledHere(userId as string),
    enabled: !!userId && support === 'supported',
  });

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s === 'supported') setPermission(Notification.permission);
  }, []);

  const refresh = async (): Promise<void> => {
    setPermission(Notification.permission);
    await queryClient.invalidateQueries({ queryKey: ['me', 'push'] });
  };

  let body;
  if (support === null) body = null;
  else if (support === 'ios-home-screen') body = <Alert tone="info">{t('iosHomeScreen')}</Alert>;
  else if (support === 'unsupported') body = <p className="text-sm text-slate-600">{t('unsupported')}</p>;
  else if (config.data && !config.data.enabled)
    body = <p className="text-sm text-slate-600">{t('serverOff')}</p>;
  else if (permission === 'denied') body = <Alert tone="warning">{t('denied')}</Alert>;
  else if (here.data)
    body = (
      <div className="space-y-2">
        <p className="text-sm text-green-700">{t('enabled')}</p>
        <Button
          variant="secondary"
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              await disablePush();
              await refresh();
            })
          }
        >
          {t('disable')}
        </Button>
      </div>
    );
  else
    body = (
      <div className="space-y-2">
        {dismissed ? <Alert tone="warning">{t('dismissed')}</Alert> : null}
        <Button
          loading={action.busy}
          disabled={!config.data?.publicKey || !userId}
          onClick={() =>
            void action.run(async () => {
              try {
                await enablePush(userId as string, config.data?.publicKey as string);
                setDismissed(false);
              } catch (e) {
                if (!(e instanceof PushPermissionError)) throw e;
                setDismissed(e.permission === 'default');
              } finally {
                await refresh();
              }
            })
          }
        >
          {t('enable')}
        </Button>
      </div>
    );

  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {body}
      <Devices />
    </Card>
  );
}
