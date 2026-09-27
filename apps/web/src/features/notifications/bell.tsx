'use client';
// Значок уведомлений в каркасе кабинета: число непрочитанных, обновляется раз в минуту.
import type { DataEnvelope, UnreadCountDto } from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export const UNREAD_KEY = ['me', 'notifications', 'unread'] as const;

export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () =>
      (await api<DataEnvelope<UnreadCountDto>>('/me/notifications/unread-count')).data.unread,
    refetchInterval: 60_000,
  });
}

export function NotificationBell() {
  const t = useTranslations('notifications');
  const unread = useUnreadCount().data ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
      aria-label={t('bell', { count: unread })}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 ? (
        <span className="absolute right-0 top-0 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
