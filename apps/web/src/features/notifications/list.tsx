'use client';
// Уведомления пользователя (API.md, 5.8): лента с текстом по типу (шаблоны — в словарях приложения), отметка
// прочтения, настройки писем и push по видам, push на этом устройстве (Phase 8b). Имена и причины сервер
// подставляет из исходных записей при чтении.
import {
  CONFIGURABLE_CHANNELS,
  type DataEnvelope,
  type NotificationDto,
  type NotificationPreferenceDto,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, PageHeader, cn } from '@sde/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import { PushDeviceCard } from './push-device';

const key = (type: string): string => type.replace('.', '_');

/** Время схватки в поясе турнира; другой день — с датой. */
export function matchTime(
  iso: string | undefined,
  timezone: string | undefined,
  locale: string,
): string | null {
  if (!iso) return null;
  try {
    const at = new Date(iso);
    const day = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(d);
    const sameDay = day(at) === day(new Date());
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
    }).format(at);
  } catch {
    return null;
  }
}

function useNotificationText(): (n: NotificationDto) => { title: string; body: string } {
  const t = useTranslations('notifications');
  const statuses = useTranslations('applications.statuses');
  const locale = useLocale();
  return (n) => {
    const none = t('noValue');
    const values = {
      competitionName: n.context.competitionName ?? none,
      organizationName: n.context.organizationName ?? none,
      athleteName: n.context.athleteName ?? none,
      categoryName: n.context.categoryName ?? none,
      documentType: n.context.documentType ?? none,
      reason: n.context.reason ?? none,
      status: n.context.status && statuses.has(n.context.status) ? statuses(n.context.status) : none,
      matNumber: n.context.matNumber ?? none,
      matchNumber: n.context.matchNumber ?? none,
      time: matchTime(n.context.plannedAt, n.context.timezone, locale) ?? none,
      ahead: Number(n.params.ahead ?? 0),
    };
    const k = key(n.type);
    // Схватка двух своих спортсменов или нет доступа к карточке — заголовок без имени.
    const title =
      !n.context.athleteName && t.has(`types.${k}.titleNoName`)
        ? t(`types.${k}.titleNoName`)
        : t(`types.${k}.title`, values);
    return { title, body: t(`types.${k}.body`, values) };
  };
}

function Preferences() {
  const t = useTranslations('notifications');
  const queryClient = useQueryClient();
  const action = useAction();
  const prefs = useQuery({
    queryKey: ['me', 'notification-preferences'],
    queryFn: async () =>
      (await api<DataEnvelope<NotificationPreferenceDto[]>>('/me/notification-preferences')).data,
  });
  const rows = prefs.data ?? [];
  const types = [...new Set(rows.map((p) => p.type))];
  const save = (p: NotificationPreferenceDto, enabled: boolean): void =>
    void action.run(async () => {
      const r = await api<DataEnvelope<NotificationPreferenceDto[]>>('/me/notification-preferences', {
        method: 'PUT',
        body: { preferences: [{ type: p.type, channel: p.channel, enabled }] },
      });
      queryClient.setQueryData(['me', 'notification-preferences'], r.data);
    });
  return (
    <Card>
      <CardTitle>{t('preferencesTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('preferencesHint')}</p>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th scope="col" className="py-1 font-medium">
              {t('kind')}
            </th>
            {CONFIGURABLE_CHANNELS.map((c) => (
              <th key={c} scope="col" className="w-16 py-1 text-center font-medium">
                {t(`channels.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type} className="border-t border-slate-100">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {t(`prefs.${key(type)}`)}
              </th>
              {CONFIGURABLE_CHANNELS.map((channel) => {
                const p = rows.find((r) => r.type === type && r.channel === channel);
                return (
                  <td key={channel} className="text-center">
                    {p ? (
                      <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={p.enabled}
                          disabled={action.busy}
                          aria-label={`${t(`prefs.${key(type)}`)}: ${t(`channels.${channel}`)}`}
                          onChange={(e) => save(p, e.target.checked)}
                        />
                      </label>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function NotificationsPage() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const text = useNotificationText();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['me', 'notifications', { unreadOnly }],
    queryFn: ({ pageParam }) =>
      api<Page<NotificationDto>>('/me/notifications', {
        query: { unreadOnly: unreadOnly || undefined, cursor: pageParam, limit: 30 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const action = useAction();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
  const open = (n: NotificationDto): void =>
    void action.run(async () => {
      if (!n.readAt) await api(`/me/notifications/${n.id}/read`, { method: 'POST' });
      await refresh();
      if (n.link) router.push(n.link);
    });
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button
            variant="secondary"
            loading={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api('/me/notifications/read-all', { method: 'POST' });
                await refresh();
              })
            }
          >
            {t('markAll')}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            {t('unreadOnly')}
          </label>
          {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
          <QueryState isPending={list.isPending} error={list.error}>
            {() =>
              rows.length === 0 ? (
                <EmptyState title={t('empty')} />
              ) : (
                <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                  {rows.map((n) => {
                    const { title, body } = text(n);
                    return (
                      <li key={n.id} className={cn('p-3', n.readAt ? '' : 'bg-blue-50')}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={cn('text-sm', n.readAt ? '' : 'font-semibold')}>{title}</p>
                            <p className="text-sm text-slate-600">{body}</p>
                            <p className="text-xs text-slate-500">{formatDateTime(n.createdAt, locale)}</p>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => open(n)}>
                            {n.link ? t('open') : t('markRead')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </QueryState>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          ) : null}
        </div>
        <div className="space-y-6">
          <PushDeviceCard />
          <Preferences />
        </div>
      </div>
    </>
  );
}
