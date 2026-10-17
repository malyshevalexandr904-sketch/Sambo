// Публикация живых данных (ADR-07; ARCHITECTURE.md, 13): общий код api и worker. Один скрипт Redis атомарно
// выдаёт следующий номер `seq` канала, при необходимости сохраняет последнее состояние (снимок для новых
// подписчиков) и рассылает сообщение всем узлам api через pub/sub — порядок сообщений канала совпадает с `seq`.
// Узлы api раздают сообщение своим подписчикам (Redis adapter Socket.IO не нужен: рассылка уже идёт через Redis).
import type { LiveMessageType } from '@sde/contracts';

/** Канал Redis pub/sub, по которому сообщения уходят узлам api. Тело: `<комната>\n<JSON сообщения>`. */
export const LIVE_REDIS_CHANNEL = 'sde:live';
/**
 * Служебные сообщения узлам api (0.13.1): `{"type":"session-role","sessionId":…}` — в сессии сменили роль кабинета;
 * узлы снимают служебные подписки соединений этой сессии, клиент подключается заново уже с новой ролью.
 */
export const LIVE_CONTROL_REDIS_CHANNEL = 'sde:live:control';
export const liveSeqKey = (room: string): string => `sde:live:seq:${room}`;
export const liveLastKey = (room: string): string => `sde:live:last:${room}`;

/** Сколько живут счётчик канала и последнее состояние без новых сообщений. */
const SEQ_TTL_SECONDS = 3 * 24 * 3600;
/** Снимок короткий: устаревшее состояние после сбоя публикации само уходит, следующий подписчик получит новое. */
export const LIVE_RETAIN_SECONDS = 60;

const PUBLISH_SCRIPT = `
local seq = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
local msg = ARGV[1] .. seq .. ARGV[2]
if ARGV[4] ~= '0' then redis.call('SET', KEYS[2], msg, 'EX', tonumber(ARGV[4])) end
redis.call('PUBLISH', ARGV[5], ARGV[6] .. '\\n' .. msg)
return seq
`;

/** Достаточно `eval` (ioredis). */
export interface LiveRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface LivePublication<P> {
  /** Имя канала в сообщении (то, на что подписан клиент). */
  channel: string;
  /** Комната рассылки и счётчика; по умолчанию — канал. У канала `user` — `user:{id}`. */
  room?: string;
  type: LiveMessageType;
  payload: P;
  /** Сохранить как последнее состояние канала (каналы состояния). */
  retain?: boolean;
}

export class LivePublisher {
  constructor(private readonly redis: LiveRedis) {}

  /** Публикует сообщение; возвращает его `seq`. */
  async publish<P>(p: LivePublication<P>): Promise<number> {
    const room = p.room ?? p.channel;
    const head = `{"v":1,"channel":${JSON.stringify(p.channel)},"seq":`;
    const tail = `,"type":${JSON.stringify(p.type)},"occurredAt":${JSON.stringify(new Date().toISOString())},"payload":${JSON.stringify(p.payload)}}`;
    const seq = await this.redis.eval(
      PUBLISH_SCRIPT,
      2,
      liveSeqKey(room),
      liveLastKey(room),
      head,
      tail,
      SEQ_TTL_SECONDS,
      p.retain ? LIVE_RETAIN_SECONDS : 0,
      LIVE_REDIS_CHANNEL,
      room,
    );
    return Number(seq);
  }
}

/** Разбор сообщения pub/sub: комната и JSON. Чужой формат — null. */
export function parseLiveRedisMessage(raw: string): { room: string; json: string } | null {
  const i = raw.indexOf('\n');
  if (i <= 0) return null;
  return { room: raw.slice(0, i), json: raw.slice(i + 1) };
}

/** Комната уведомлений пользователя. */
export const liveUserRoom = (userId: string): string => `user:${userId}`;
