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
  'schedule.changed',
  'results.published',
  'match.soon',
  'match.started',
  'match.time_changed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Уведомления дня соревнований (Phase 8b; раздел 30): о схватках спортсмена — его представителям, ему самому и
 * подписавшимся. Письмо приходит слишком поздно, чтобы успеть к ковру, — по умолчанию выключено.
 */
export const MATCH_DAY_NOTIFICATION_TYPES = [
  'match.soon',
  'match.started',
  'match.time_changed',
] as const satisfies readonly NotificationType[];

export const isMatchDayNotification = (type: string): boolean =>
  (MATCH_DAY_NOTIFICATION_TYPES as readonly string[]).includes(type);

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Каналы, которые пользователь может настроить сейчас. Лента в приложении ведётся всегда. */
export const CONFIGURABLE_CHANNELS = ['EMAIL', 'PUSH'] as const satisfies readonly NotificationChannel[];
export type ConfigurableChannel = (typeof CONFIGURABLE_CHANNELS)[number];

/**
 * Канал включён, если пользователь его не настраивал: всё включено, кроме писем уведомлений дня соревнований
 * (план Phase 8b, вопрос 3).
 */
export function notificationChannelDefault(type: NotificationType, channel: ConfigurableChannel): boolean {
  return !(channel === 'EMAIL' && isMatchDayNotification(type));
}

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
  categoryName?: string;
  organizationName?: string;
  athleteName?: string;
  documentType?: string;
  status?: string;
  reason?: string;
  /** Схватка (уведомления дня соревнований): номер ковра, номер схватки, плановое время (ISO), пояс турнира. */
  matNumber?: string;
  matchNumber?: string;
  plannedAt?: string;
  timezone?: string;
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

/**
 * Ссылка из уведомления: заявка, раздел документов, турнир; «опубликованы результаты» и уведомления дня
 * соревнований — карточка спортсмена, если у получателя один спортсмен, иначе турнир.
 */
export function notificationLink(type: NotificationType, params: Record<string, string>): string | null {
  if (type === 'document.rejected') return '/documents';
  if (isMatchDayNotification(type)) {
    if (params.athleteId) return `/athletes/${params.athleteId}`;
    return params.competitionId ? `/competitions/${params.competitionId}` : null;
  }
  if (type === 'results.published') {
    if (params.athleteId) return `/athletes/${params.athleteId}`;
    return params.competitionId ? `/competitions/${params.competitionId}` : null;
  }
  if (type === 'schedule.changed')
    return params.competitionId ? `/competitions/${params.competitionId}` : null;
  return params.applicationId ? `/applications/${params.applicationId}` : null;
}

// ---------- Web Push (Phase 8b) ----------

/** Push включён на сервере (ключи VAPID есть) и открытый ключ для `PushManager.subscribe`. */
export interface PushConfigDto {
  enabled: boolean;
  /** Открытый ключ VAPID (P-256, base64url). */
  publicKey: string | null;
}

const Base64Url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, { error: 'invalid_base64url' });

/**
 * Подписка браузера (`PushSubscription.toJSON()`): адрес push-службы и ключи шифрования устройства.
 * `onlyIfMine` — только обновить сессию устройства, уже подписанного этим пользователем (открытие приложения после
 * нового входа): чужое устройство так не перехватывается — для него нужна явная подписка.
 */
export const PushSubscriptionPut = z.object({
  endpoint: z.url({ protocol: /^https$/, error: 'invalid_endpoint' }).max(2048),
  keys: z.object({ p256dh: Base64Url(80, 100), auth: Base64Url(16, 32) }),
  onlyIfMine: z.boolean().optional(),
});
export type PushSubscriptionPut = z.infer<typeof PushSubscriptionPut>;

export const PushSubscriptionDelete = z.object({ endpoint: z.string().min(1).max(2048) });
export type PushSubscriptionDelete = z.infer<typeof PushSubscriptionDelete>;

/** Устройство пользователя в настройках: без адреса push-службы, только браузер и даты. */
export interface PushDeviceDto {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Не больше устройств на пользователя: при подписке нового самое старое удаляется. */
export const MAX_PUSH_DEVICES = 10;

/**
 * Сообщение push (worker → service worker `/sw.js`): заголовок и текст без имён детей, ссылка в приложении
 * (путь без локали — service worker добавляет локаль пользователя), метка для замены прежнего уведомления.
 */
export interface PushMessage {
  v: 1;
  title: string;
  body: string;
  /** Путь в приложении с локалью: `/ru/athletes/…`. */
  url: string;
  tag: string;
}

// ---------- Подписки на спортсменов (Phase 8b) ----------

export interface FollowStateDto {
  following: boolean;
}

export interface FollowDto {
  athleteId: string;
  /** «Фамилия И.» — пока пользователь видит карточку спортсмена; доступа больше нет — null. */
  name: string | null;
  createdAt: string;
}

export const ApplicationFollow = z.object({ follow: z.boolean().default(true) });
export type ApplicationFollow = z.infer<typeof ApplicationFollow>;

export interface ApplicationFollowResultDto {
  /** Спортсменов заявки (одобренные участия), на которых пользователь подписан после команды. */
  following: number;
  total: number;
}

/**
 * Адрес push-службы безопасен для отправки с сервера (SSRF): https на стандартном порту, без учётных данных, имя
 * хоста с точкой — не IP-адрес и не localhost. Адреса, в которые хост превращается, проверяет worker при отправке.
 * Возвращает причину отказа или null.
 */
export function pushEndpointProblem(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'not_https';
  if (url.username || url.password) return 'credentials';
  if (url.port && url.port !== '443') return 'port';
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f:]+$/.test(host))
    return 'ip_host';
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return 'local_host';
  return null;
}
