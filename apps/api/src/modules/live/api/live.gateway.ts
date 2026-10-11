// WebSocket-шлюз живых данных (Phase 8a; ADR-07; API.md, 7): Socket.IO на пути /ws, пространство имён /live.
// Клиент подписывается на каналы и получает сообщения; команды не принимаются — только REST (одна точка проверки
// прав, валидации и идемпотентности). Сообщения приходят из Redis pub/sub (их публикует ведущий узел api или
// worker) и раздаются подписчикам этого узла.
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  COOKIE_ACCESS,
  LIVE_CLIENT_RATE_PER_SECOND,
  LIVE_EVENTS,
  LIVE_MAX_SUBSCRIPTIONS,
  LIVE_NAMESPACE,
  LIVE_PATH,
  type LiveAck,
  type LiveErrorCode,
  type LivePongAck,
  LiveSubscribeRequest,
  type LiveSubscribeAck,
  LiveUnsubscribeRequest,
  parseLiveChannel,
} from '@sde/contracts';
import { type Env, LIVE_REDIS_CHANNEL, parseLiveRedisMessage } from '@sde/server-kit';
import type { Server as HttpServer } from 'node:http';
import { Redis } from 'ioredis';
import { type Namespace, Server, type Socket } from 'socket.io';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import { AccessTokenAuthenticator } from '../../auth';
import {
  ChannelAccessService,
  type ChannelGrant,
  LiveDenied,
  type Subscriber,
} from '../application/channel-access.service';

interface SocketState extends Subscriber {
  subscriptions: Map<string, ChannelGrant>;
  expiryTimer: NodeJS.Timeout | null;
  window: { startedAt: number; count: number };
  /** Очередь запросов по каналу: отписка ждёт идущую подписку того же канала (иначе подписка «осиротеет»). */
  queues: Map<string, Promise<unknown>>;
  ip: string;
}

/** Соединений с одного адреса на узле: экраны и табло зала за одним NAT — десятки, не сотни. */
const MAX_CONNECTIONS_PER_IP = 200;

const LIVE_CODES = new Set<string>([
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
]);

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const fail = (code: LiveErrorCode): { ok: false; error: { code: LiveErrorCode } } => ({
  ok: false,
  error: { code },
});

/** Ответ клиенту, если он его ждёт (ack — функция последним аргументом). */
function reply<T>(ack: unknown, value: T): void {
  if (typeof ack === 'function') (ack as (v: T) => void)(value);
}

@Injectable()
export class LiveGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('LiveGateway');
  private io: Server | null = null;
  private nsp: Namespace | null = null;
  private subscriber: Redis | null = null;
  private readonly allowedOrigins: Set<string>;
  private readonly perIp = new Map<string, number>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
    private readonly authenticator: AccessTokenAuthenticator,
    private readonly access: ChannelAccessService,
  ) {
    this.allowedOrigins = new Set([new URL(env.APP_URL).origin, ...env.CORS_ORIGINS]);
  }

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as HttpServer;
    const io = new Server(httpServer, {
      path: LIVE_PATH,
      addTrailingSlash: false,
      serveClient: false,
      maxHttpBufferSize: 16 * 1024,
      pingInterval: 20_000,
      pingTimeout: 20_000,
      connectTimeout: 10_000,
    });
    // Пространство имён по умолчанию не используется.
    io.use((_socket, next) => next(new Error('namespace')));
    const nsp = io.of(LIVE_NAMESPACE);
    nsp.use((socket, next) => {
      const ip = this.clientIp(socket);
      if ((this.perIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) return next(new Error('too many connections'));
      // Отказ (сбой БД или Redis при проверке входа) клиент повторит сам: socket.io-client после отказа
      // middleware не переподключается, это делает LiveClient (apps/web/src/lib/live-client.ts).
      this.authenticate(socket, ip).then(
        () => next(),
        (err: unknown) => {
          this.logger.warn({ err }, 'Live handshake failed');
          next(new Error('handshake'));
        },
      );
    });
    nsp.on('connection', (socket) => this.onConnection(socket));
    this.io = io;
    this.nsp = nsp;

    const subscriber = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on('message', (_channel: string, raw: string) => this.deliver(raw));
    subscriber.on('error', (err) => this.logger.warn({ err }, 'Live subscriber: Redis error'));
    void subscriber.subscribe(LIVE_REDIS_CHANNEL).catch((err: unknown) => {
      this.logger.error({ err }, 'Live subscriber: subscribe failed');
    });
    this.subscriber = subscriber;
  }

  /** До отключения Prisma и Redis приложения: подписчики отключаются, новые подписки не считаются. */
  async onModuleDestroy(): Promise<void> {
    this.nsp?.disconnectSockets(true);
    // Сам HTTP-сервер закрывает Nest; Socket.IO закрывает только свой движок.
    this.io?.engine.close();
    this.io = null;
    this.nsp = null;
    await this.subscriber?.quit().catch(() => undefined);
    this.subscriber = null;
  }

  /** Подключения узла (наблюдение и тесты). */
  get connections(): number {
    return this.nsp?.sockets.size ?? 0;
  }

  private deliver(raw: string): void {
    const parsed = parseLiveRedisMessage(raw);
    if (!parsed || !this.nsp) return;
    try {
      this.nsp.to(parsed.room).emit(LIVE_EVENTS.message, JSON.parse(parsed.json));
    } catch (err) {
      this.logger.warn({ err }, 'Live message dropped: invalid JSON');
    }
  }

  /** Адрес клиента: за Caddy (TRUST_PROXY — один прокси) — последний адрес X-Forwarded-For, как у HTTP. */
  private clientIp(socket: Socket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = header?.split(',').pop()?.trim();
    return this.env.TRUST_PROXY && last ? last : socket.handshake.address;
  }

  /**
   * Вход по Bearer (`auth.token`) или cookie `sde_at`. Cookie принимается только без Origin или с разрешённого
   * Origin: страница чужого сайта не подключится к служебным каналам от имени пользователя (CSWSH). Без Origin
   * браузер WebSocket не открывает; cookie `sde_at` — SameSite=Lax.
   */
  private async authenticate(socket: Socket, ip: string): Promise<void> {
    const state: SocketState = {
      user: null,
      authError: null,
      subscriptions: new Map(),
      expiryTimer: null,
      window: { startedAt: Date.now(), count: 0 },
      queues: new Map(),
      ip,
    };
    socket.data = state;
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const bearer = typeof auth?.token === 'string' && auth.token ? auth.token : null;
    const origin = socket.handshake.headers.origin;
    const cookie =
      !origin || this.allowedOrigins.has(origin)
        ? readCookie(socket.handshake.headers.cookie, COOKIE_ACCESS)
        : null;
    const token = bearer ?? cookie;
    if (!token) return;
    try {
      const { user, expiresAt } = await this.authenticator.authenticate(token, bearer ? 'bearer' : 'cookie');
      state.user = user;
      const ms = expiresAt.getTime() - Date.now();
      state.expiryTimer = setTimeout(() => this.expire(socket), Math.max(0, ms));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      state.authError = e.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED';
    }
  }

  /** Срок входа истёк: служебные подписки сняты, клиенту — `expired` (обновить сессию и подключиться заново). */
  private expire(socket: Socket): void {
    this.dropUser(socket, socket.data as SocketState, 'TOKEN_EXPIRED');
    socket.emit(LIVE_EVENTS.expired);
  }

  /** Соединение становится анонимным: служебные подписки сняты, публичные остаются. */
  private dropUser(socket: Socket, state: SocketState, reason: LiveErrorCode): void {
    state.user = null;
    state.authError = reason;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
    for (const [channel, grant] of state.subscriptions) {
      if (!grant.private) continue;
      state.subscriptions.delete(channel);
      void socket.leave(grant.room);
    }
  }

  private allow(state: SocketState): boolean {
    const now = Date.now();
    if (now - state.window.startedAt >= 1_000) state.window = { startedAt: now, count: 0 };
    state.window.count += 1;
    return state.window.count <= LIVE_CLIENT_RATE_PER_SECOND;
  }

  /** Запросы одного канала — по очереди, в порядке прихода. */
  private queued<T>(state: SocketState, raw: unknown, fn: () => Promise<T>): Promise<T> {
    const channel =
      typeof raw === 'object' && raw !== null && typeof (raw as { channel?: unknown }).channel === 'string'
        ? (raw as { channel: string }).channel.slice(0, 160)
        : '';
    const prev = state.queues.get(channel) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    state.queues.set(channel, tail);
    void tail.then(() => {
      if (state.queues.get(channel) === tail) state.queues.delete(channel);
    });
    return run;
  }

  private onConnection(socket: Socket): void {
    const state = socket.data as SocketState;
    // Принятые соединения с адреса (лимит проверяется в рукопожатии).
    this.perIp.set(state.ip, (this.perIp.get(state.ip) ?? 0) + 1);
    socket.on(LIVE_EVENTS.subscribe, (raw: unknown, ack: unknown) => {
      if (!this.allow(state)) return reply(ack, fail('RATE_LIMITED'));
      void this.queued(state, raw, () => this.subscribe(socket, state, raw)).then((r) => reply(ack, r));
    });
    socket.on(LIVE_EVENTS.unsubscribe, (raw: unknown, ack: unknown) => {
      if (!this.allow(state)) return reply(ack, fail('RATE_LIMITED'));
      void this.queued(state, raw, () => this.unsubscribe(socket, state, raw)).then((r) =>
        reply<LiveAck>(ack, r),
      );
    });
    socket.on(LIVE_EVENTS.ping, (_raw: unknown, ack: unknown) => {
      if (!this.allow(state)) return;
      reply<LivePongAck>(ack, { serverTime: Date.now() });
    });
    socket.on('disconnect', () => {
      if (state.expiryTimer) clearTimeout(state.expiryTimer);
      state.subscriptions.clear();
      const left = (this.perIp.get(state.ip) ?? 1) - 1;
      if (left > 0) this.perIp.set(state.ip, left);
      else this.perIp.delete(state.ip);
    });
  }

  private async subscribe(socket: Socket, state: SocketState, raw: unknown): Promise<LiveSubscribeAck> {
    const req = LiveSubscribeRequest.safeParse(raw);
    if (!req.success) return fail('VALIDATION_FAILED');
    const { channel, lastSeq } = req.data;
    const parsed = parseLiveChannel(channel);
    if (!parsed) return fail('VALIDATION_FAILED');
    if (!state.subscriptions.has(channel) && state.subscriptions.size >= LIVE_MAX_SUBSCRIPTIONS)
      return fail('RATE_LIMITED');
    try {
      // Служебный канал — сессия ещё действует (выход на другом устройстве, отзыв администратором), пользователь
      // не заблокирован, права — текущие (снятая должность в турнире действует сразу, как в REST).
      if (state.user && !parsed.kind.startsWith('public:')) {
        try {
          state.user = await this.authenticator.reload(state.user);
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          this.dropUser(socket, state, 'UNAUTHENTICATED');
        }
      }
      const grant = await this.access.authorize(state, parsed, channel);
      // Сначала комната, потом номер и снимок: сообщение, пришедшее между ними, клиент отбросит по seq.
      await socket.join(grant.room);
      state.subscriptions.set(channel, grant);
      const { seq, snapshot } = await this.access.snapshot(grant, channel);
      return { ok: true, seq, snapshot: lastSeq !== undefined && lastSeq === seq ? null : snapshot };
    } catch (e) {
      const grant = state.subscriptions.get(channel);
      if (grant) {
        state.subscriptions.delete(channel);
        await socket.leave(grant.room);
      }
      if (e instanceof LiveDenied) return fail(e.code);
      if (e instanceof DomainError && LIVE_CODES.has(e.code)) return fail(e.code as LiveErrorCode);
      this.logger.error({ err: e, channel }, 'Live subscribe failed');
      return fail('INTERNAL_ERROR');
    }
  }

  private async unsubscribe(socket: Socket, state: SocketState, raw: unknown): Promise<LiveAck> {
    const req = LiveUnsubscribeRequest.safeParse(raw);
    if (!req.success) return fail('VALIDATION_FAILED');
    const grant = state.subscriptions.get(req.data.channel);
    if (grant) {
      state.subscriptions.delete(req.data.channel);
      await socket.leave(grant.room);
    }
    return { ok: true };
  }
}
