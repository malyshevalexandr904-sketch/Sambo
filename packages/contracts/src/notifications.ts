// Уведомления (API.md, 5.8; DATABASE.md, 3.8): типы, каналы, настройки пользователя. Тексты — в репозитории:
// веб-приложение переводит тип по ключу `notifications.types.<type>`, письма рендерит worker. В `params` —
// только идентификаторы и коды; имена и причины подставляются при чтении из исходных записей.
import { z } from 'zod';
import { PageQuery } from './common.js';

export const NOTIFICATION_TYPES = [
  'application.returned',
  'application.decided',
  'entry.rejected',
  'document.rejected',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Каналы, которые пользователь может настроить сейчас. Лента в приложении ведётся всегда. */
export const CONFIGURABLE_CHANNELS = ['EMAIL'] as const satisfies readonly NotificationChannel[];
export type ConfigurableChannel = (typeof CONFIGURABLE_CHANNELS)[number];

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const NotificationsQuery = PageQuery.extend({ unreadOnly: z.stringbool().optional() });
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;

export const NotificationPreferenceInput = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(CONFIGURABLE_CHANNELS),
  enabled: z.boolean(),
});
export type NotificationPreferenceInput = z.infer<typeof NotificationPreferenceInput>;

export const NotificationPreferencesPut = z.object({
  preferences: z
    .array(NotificationPreferenceInput)
    .max(NOTIFICATION_TYPES.length * CONFIGURABLE_CHANNELS.length),
});
export type NotificationPreferencesPut = z.infer<typeof NotificationPreferencesPut>;

/**
 * Подстановки для текста: названия и причины из исходных записей на момент чтения. Поля, которых нет у типа
 * или которые пользователю больше не видны, отсутствуют.
 */
export interface NotificationContext {
  competitionName?: string;
  organizationName?: string;
  athleteName?: string;
  documentType?: string;
  status?: string;
  reason?: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  params: Record<string, string>;
  context: NotificationContext;
  /** Путь в приложении без локали: `/applications/{id}`, `/documents`. */
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface UnreadCountDto {
  unread: number;
}

export interface NotificationPreferenceDto {
  type: NotificationType;
  channel: ConfigurableChannel;
  enabled: boolean;
}

/** Ссылка из уведомления: заявка или раздел документов. */
export function notificationLink(type: NotificationType, params: Record<string, string>): string | null {
  if (type === 'document.rejected') return '/documents';
  return params.applicationId ? `/applications/${params.applicationId}` : null;
}
