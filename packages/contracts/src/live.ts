// Живые данные (Phase 8a; API.md, 7; ARCHITECTURE.md, 13; ADR-07): протокол WebSocket-шлюза, каналы, конверт
// сообщения и проекции, которые приходят по каналам. Команды по WebSocket не принимаются — только REST.
import { z } from 'zod';
import type { LocalizedText } from './common.js';
import type { MatchResultStatus, MatchStatus, Side, WinMethod } from './draws.js';
import type { ErrorCode } from './errors.js';

/** Путь Socket.IO (Caddy и Next.js проксируют его в api) и пространство имён. */
export const LIVE_PATH = '/ws';
export const LIVE_NAMESPACE = '/live';

/**
 * События протокола: запросы клиента с ответом (ack), сообщение канала и «вход истёк» от сервера (срок access
 * token: служебные подписки сняты — клиент обновляет сессию и подключается заново).
 */
export const LIVE_EVENTS = {
  subscribe: 'subscribe',
  unsubscribe: 'unsubscribe',
  ping: 'ping',
  message: 'message',
  expired: 'expired',
} as const;

/** Не больше подписок на одно соединение (экран подписан на единицы каналов). */
export const LIVE_MAX_SUBSCRIPTIONS = 50;
/** Запросов клиента в секунду на соединение (subscribe, unsubscribe, ping). */
export const LIVE_CLIENT_RATE_PER_SECOND = 20;

// ---------- Каналы ----------

/**
 * Каналы (API.md, 7.2). Публичные — без входа, только публичная проекция; служебные — `competition.view` в турнире;
 * `user` — уведомления вошедшего пользователя (сервер подписывает только на свои).
 */
export const liveChannel = {
  publicMat: (competitionSlug: string, matNumber: number) => `public:mat:${competitionSlug}:${matNumber}`,
  publicMatch: (matchPublicId: string) => `public:match:${matchPublicId}`,
  publicCompetition: (competitionSlug: string) => `public:competition:${competitionSlug}`,
  opsCompetition: (competitionId: string) => `ops:competition:${competitionId}`,
  opsMat: (matId: string) => `ops:mat:${matId}`,
  opsMatch: (matchId: string) => `ops:match:${matchId}`,
  user: 'user',
} as const;

const SLUG = '[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PUBLIC_ID = '[A-Za-z0-9_-]{6,32}';

/** Разбор имени канала: вид и параметры. Незнакомое имя — null. */
export type ParsedLiveChannel =
  | { kind: 'public:mat'; slug: string; matNumber: number }
  | { kind: 'public:match'; publicId: string }
  | { kind: 'public:competition'; slug: string }
  | { kind: 'ops:competition'; competitionId: string }
  | { kind: 'ops:mat'; matId: string }
  | { kind: 'ops:match'; matchId: string }
  | { kind: 'user' };

const PATTERNS: [RegExp, (m: RegExpExecArray) => ParsedLiveChannel | null][] = [
  [
    new RegExp(`^public:mat:(${SLUG}):(\\d{1,3})$`),
    (m) => {
      const matNumber = Number(m[2]);
      return matNumber >= 1 ? { kind: 'public:mat', slug: m[1] as string, matNumber } : null;
    },
  ],
  [new RegExp(`^public:match:(${PUBLIC_ID})$`), (m) => ({ kind: 'public:match', publicId: m[1] as string })],
  [
    new RegExp(`^public:competition:(${SLUG})$`),
    (m) => ({ kind: 'public:competition', slug: m[1] as string }),
  ],
  [
    new RegExp(`^ops:competition:(${UUID})$`),
    (m) => ({ kind: 'ops:competition', competitionId: m[1] as string }),
  ],
  [new RegExp(`^ops:mat:(${UUID})$`), (m) => ({ kind: 'ops:mat', matId: m[1] as string })],
  [new RegExp(`^ops:match:(${UUID})$`), (m) => ({ kind: 'ops:match', matchId: m[1] as string })],
  [/^user$/, () => ({ kind: 'user' })],
];

export function parseLiveChannel(channel: string): ParsedLiveChannel | null {
  if (channel.length > 160) return null;
  for (const [re, build] of PATTERNS) {
    const m = re.exec(channel);
    if (m) return build(m);
  }
  return null;
}

export const isPublicLiveChannel = (channel: string): boolean => channel.startsWith('public:');

// ---------- Сообщения ----------

/**
 * Типы сообщений. Каналы состояния (`public:mat`, `public:match`) несут полное состояние — снимок при подписке
 * равен последнему сообщению. Каналы изменений (`ops:*`, `public:competition`, `user`) говорят, что изменилось:
 * клиент перечитывает данные по REST.
 */
export const LIVE_MESSAGE_TYPES = ['mat.state', 'match.state', 'changed', 'notification'] as const;
export type LiveMessageType = (typeof LIVE_MESSAGE_TYPES)[number];

/** Конверт сообщения канала (API.md, 7.3). `seq` монотонен в канале. */
export interface LiveMessage<P = unknown> {
  v: 1;
  channel: string;
  seq: number;
  type: LiveMessageType;
  occurredAt: string;
  payload: P;
}

/** Что изменилось в турнире (каналы `ops:*`, `public:competition`): по темам и идентификаторам. */
export const LIVE_TOPICS = [
  'competition',
  'categories',
  'registrations',
  'admission',
  'checkin',
  'weighin',
  'medical',
  'draws',
  'schedule',
  'crews',
  'matches',
  'results',
] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

export interface LiveChangedPayload {
  topics: LiveTopic[];
  categoryIds: string[];
  matIds: string[];
  matchIds: string[];
}

/** Новое уведомление пользователя (канал `user`): клиент обновляет колокольчик и ленту. */
export interface LiveNotificationPayload {
  notificationId: string;
  type: string;
}

// ---------- Протокол ----------

export const LiveSubscribeRequest = z.object({
  channel: z.string().min(1).max(160),
  lastSeq: z.number().int().min(0).optional(),
});
export type LiveSubscribeRequest = z.infer<typeof LiveSubscribeRequest>;

export const LiveUnsubscribeRequest = z.object({ channel: z.string().min(1).max(160) });
export type LiveUnsubscribeRequest = z.infer<typeof LiveUnsubscribeRequest>;

export const LivePingRequest = z.object({ clientTime: z.number().optional() });

export type LiveErrorCode = Extract<
  ErrorCode,
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
>;

/**
 * Ответ на подписку. `seq` — номер последнего сообщения канала (0 — сообщений ещё не было); `snapshot` — последнее
 * состояние (только каналы состояния). Клиент с `lastSeq` = `seq` ничего не пропустил.
 */
export type LiveSubscribeAck =
  { ok: true; seq: number; snapshot: LiveMessage | null } | { ok: false; error: { code: LiveErrorCode } };

export type LiveAck = { ok: true } | { ok: false; error: { code: LiveErrorCode } };

export interface LivePongAck {
  serverTime: number;
}

// ---------- Табло ковра (канал public:mat, публичная проекция ADR-15) ----------

export interface LiveSideDto {
  /** «Фамилия И.» (Q-04); null — участник ещё не известен или имя скрыто (`hidden`). */
  name: string | null;
  /** Нет действующего согласия на распространение ПДн: имя не публикуется, табло показывает угол и клуб. */
  hidden: boolean;
  club: string | null;
  region: string | null;
}

export interface LiveSideScoreDto {
  points: number;
  /** Наказания по порядку (коды правил). */
  penalties: string[];
}

/**
 * Схватка на табло. Время — по часам сервера: основной секундомер — «значение + момент» (`clock.at`), удержание —
 * момент начала; табло досчитывает идущее время само с поправкой на смещение часов (`ping`).
 */
export interface LiveMatchDto {
  publicId: string;
  number: number | null;
  roundLabel: string;
  category: LocalizedText;
  status: MatchStatus;
  red: LiveSideDto;
  blue: LiveSideDto;
  /** Счёт; до старта — null. */
  score: { red: LiveSideScoreDto; blue: LiveSideScoreDto } | null;
  clock: { running: boolean; elapsedMs: number; durationMs: number; at: string | null } | null;
  hold: { side: Side; startedAt: string; maxMs: number } | null;
  /** Результат (предварительный или подтверждённый). */
  result: {
    status: MatchResultStatus;
    winnerSide: Side | null;
    method: WinMethod;
    methodDetail: string | null;
    redScore: number | null;
    blueScore: number | null;
  } | null;
  finishedAt: string | null;
  /** Версия схватки и номер события журнала: более старое состояние табло отбрасывает. */
  version: number;
  seq: number;
}

/** Состояние ковра для табло: текущая схватка (идёт или вызвана), последняя завершённая и следующая пара. */
export interface PublicMatStateDto {
  competition: { slug: string; name: string; timezone: string };
  mat: { id: string; number: number; name: string | null };
  /** Канал для подписки (`public:mat:{slug}:{номер}`). */
  channel: string;
  current: LiveMatchDto | null;
  /** Последняя завершённая на этом ковре за последний час: показывается, пока не вызвана следующая. */
  last: LiveMatchDto | null;
  next: LiveMatchDto | null;
  serverTime: string;
}

/** Сколько показывать результат последней схватки, если следующую не вызвали. */
export const LIVE_LAST_RESULT_MS = 60 * 60 * 1000;

/** Табло отбрасывает состояние схватки, которое старше показанного (сообщения могут прийти не по порядку). */
export function isNewerMatchState(next: LiveMatchDto, shown: LiveMatchDto | null): boolean {
  if (!shown || shown.publicId !== next.publicId) return true;
  return next.version > shown.version || (next.version === shown.version && next.seq >= shown.seq);
}

/** Прошедшее время основного секундомера по часам сервера `serverNowMs` (не дольше длительности схватки). */
export function liveClockMs(clock: NonNullable<LiveMatchDto['clock']>, serverNowMs: number): number {
  if (!clock.running || !clock.at) return clock.elapsedMs;
  return Math.min(clock.durationMs, clock.elapsedMs + Math.max(0, serverNowMs - Date.parse(clock.at)));
}

/** Длительность идущего удержания по часам сервера (не дольше максимального порога). */
export function liveHoldMs(hold: NonNullable<LiveMatchDto['hold']>, serverNowMs: number): number {
  return Math.min(hold.maxMs, Math.max(0, serverNowMs - Date.parse(hold.startedAt)));
}
