// Лента изменений для живых данных (Phase 8a; ARCHITECTURE.md, 13): уведомления PostgreSQL `sde_live` (триггер на
// журнале синхронизации, приходят только после commit) → пачки → LiveRouterService. Узлов api может быть
// несколько: публикует ведущий (блокировка в Redis с продлением), раздают сообщения все. Соединение прослушивания
// проверяется запросом при каждом продлении: «тихий» обрыв (NAT, межсетевой экран) снимает роль ведущего. Новый
// ведущий (в том числе после восстановления связи) пересинхронизирует действующие турниры — изменения, записанные,
// пока ленту никто не слушал, экраны получают «перечитать всё».
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Env } from '@sde/server-kit';
import { randomUUID } from 'node:crypto';
import { Client, type Notification } from 'pg';
import { ENV } from '../../../config/config.module';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import type { ChangeRow } from '../domain/change-routing';
import { LiveRouterService } from './live-router.service';

export const LIVE_PG_CHANNEL = 'sde_live';
const LEADER_KEY = 'sde:live:leader';
const LEADER_TTL_MS = 10_000;
const LEADER_RENEW_MS = 3_000;
/** Проверка соединения прослушивания: не ответило дважды подряд — соединение считается потерянным. */
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_MAX_TIMEOUTS = 2;
/** Окно сбора пачки: изменения одной команды приходят вместе и публикуются одним сообщением. */
const BATCH_WINDOW_MS = 40;
const BATCH_MAX = 1_000;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const OPS = new Set(['INSERT', 'UPDATE', 'DELETE']);

/** Разбор уведомления; чужой формат — null. */
export function parseChange(payload: string | undefined): ChangeRow | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    const str = (k: string): string | null => (typeof p[k] === 'string' ? p[k] : null);
    const t = str('t');
    const op = str('op');
    if (!t || !op || !OPS.has(op)) return null;
    return {
      c: str('c'),
      t,
      id: str('id'),
      op: op as ChangeRow['op'],
      m: str('m'),
      cat: str('cat'),
      mat: str('mat'),
      v: str('v'),
      s: str('s'),
    };
  } catch {
    return null;
  }
}

@Injectable()
export class ChangeFeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('LiveFeed');
  private readonly nodeId = randomUUID();
  private client: Client | null = null;
  private listening = false;
  private leader = false;
  private stopped = false;
  private buffer: ChangeRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private leaderTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1_000;
  private flushing: Promise<void> | null = null;
  private resyncing: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  private healthTimeouts = 0;
  private lastResyncAt = Number.NEGATIVE_INFINITY;
  /** Полная пересинхронизация — не чаще (база перегружена, ведущий меняется раз за разом). Тесты уменьшают. */
  resyncMinIntervalMs = 30_000;
  private resyncTimer: NodeJS.Timeout | null = null;
  /** Последнее успешное продление (или захват) блокировки ведущего. */
  private renewedAt = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly router: LiveRouterService,
  ) {}

  get isLeader(): boolean {
    return this.leader;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.connect();
    await this.leadership();
    this.leaderTimer = setInterval(() => void this.leadership(), LEADER_RENEW_MS);
    this.leaderTimer.unref();
  }

  /**
   * Остановка — при уничтожении модуля, до отключения Prisma (хуки уничтожения идут в обратном порядке
   * инициализации): идущая публикация дочитывает данные из БД и завершается.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.leaderTimer) clearInterval(this.leaderTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flushing?.catch(() => undefined);
    await this.resyncing?.catch(() => undefined);
    await this.release();
    const client = this.client;
    this.client = null;
    this.listening = false;
    await client?.end().catch(() => undefined);
  }

  /**
   * Проверить и при необходимости занять роль ведущего сейчас, не дожидаясь продления (тесты и диагностика):
   * потерянная блокировка (Redis очищен, срок истёк) сначала снимает роль, повторная проверка занимает её снова.
   */
  async ensureLeadership(): Promise<boolean> {
    await this.leadership();
    if (!this.leader) await this.leadership();
    await this.resyncing;
    return this.leader;
  }

  /** Дождаться публикации накопленных изменений и пересинхронизации (тесты и плавная остановка). */
  async drain(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flush();
    }
    while (this.flushing || this.resyncing) await (this.flushing ?? this.resyncing);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({
      connectionString: this.env.DATABASE_URL,
      application_name: 'sde-live',
      // TCP keepalive: соединение, которое долго молчит, не закрывает NAT или межсетевой экран.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    client.on('notification', (n: Notification) => this.onNotification(n));
    client.on('error', (err) => this.onConnectionLost(client, err));
    client.on('end', () => this.onConnectionLost(client, null));
    try {
      await client.connect();
      await client.query(`LISTEN ${LIVE_PG_CHANNEL}`);
      this.client = client;
      this.listening = true;
      this.reconnectDelay = 1_000;
    } catch (err) {
      this.logger.warn({ err }, 'Live feed: database connection failed');
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private onConnectionLost(client: Client, err: Error | null): void {
    if (this.client !== client) return;
    this.client = null;
    this.listening = false;
    if (this.stopped) return;
    this.logger.warn({ err }, 'Live feed: database connection lost');
    // Без прослушивания публиковать нельзя: уступаем ведущего узлу со связью.
    void this.release();
    void client.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelay);
    this.reconnectTimer.unref();
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  /** Проверки не накладываются: продление по таймеру и `ensureLeadership` ждут одну и ту же. */
  private leadership(): Promise<void> {
    this.checking ??= this.checkLeadership().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async checkLeadership(): Promise<void> {
    if (this.stopped) return;
    // Продления не было дольше срока блокировки (Redis недоступен, процесс стоял): её мог занять другой узел.
    if (this.leader && Date.now() - this.renewedAt >= LEADER_TTL_MS) this.loseLeadership('expired');
    if (!(await this.healthy())) {
      if (this.leader) await this.release();
      return;
    }
    try {
      if (this.leader) {
        const renewed = await this.redis.eval(RENEW_SCRIPT, 1, LEADER_KEY, this.nodeId, LEADER_TTL_MS);
        if (Number(renewed) === 1) this.renewedAt = Date.now();
        else this.loseLeadership('taken');
        return;
      }
      const acquired = await this.redis.set(LEADER_KEY, this.nodeId, 'PX', LEADER_TTL_MS, 'NX');
      if (acquired === 'OK') {
        this.leader = true;
        this.renewedAt = Date.now();
        this.router.reset();
        this.logger.log('Live feed: this node publishes live updates');
        this.resync();
      }
    } catch (err) {
      // Продлить не удалось — публикацию прекращаем: иначе после истечения блокировки ведущих станет двое.
      if (this.leader) this.loseLeadership('renew failed');
      this.logger.warn({ err }, 'Live feed: leadership check failed');
    }
  }

  private loseLeadership(why: string): void {
    this.leader = false;
    this.buffer = [];
    this.logger.warn({ why }, 'Live feed: leadership lost');
  }

  /**
   * Соединение прослушивания живо: отвечает на запрос. Ошибка запроса — переподключение сразу; нет ответа дважды
   * подряд (перегруженная база отвечает медленно, но соединение цело) — тоже.
   */
  private async healthy(): Promise<boolean> {
    const client = this.client;
    if (!this.listening || !client) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), HEALTH_TIMEOUT_MS);
    });
    try {
      const r = await Promise.race([client.query('SELECT 1'), timeout]);
      if (r !== 'timeout') {
        this.healthTimeouts = 0;
        return true;
      }
      this.healthTimeouts += 1;
      if (this.healthTimeouts < HEALTH_MAX_TIMEOUTS) return this.listening;
      this.healthTimeouts = 0;
      this.onConnectionLost(client, new Error('health check timeout'));
      return false;
    } catch (err) {
      this.healthTimeouts = 0;
      this.onConnectionLost(client, err instanceof Error ? err : null);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Пересинхронизация действующих турниров — одна за раз и не чаще раза в 30 с (иначе — позже, по таймеру). Идущая
   * публикация пачки завершается до неё, накопленные за время пересинхронизации изменения публикуются после: так
   * сохранённый снимок не оказывается старее опубликованного.
   */
  private resync(): void {
    if (this.resyncing) return;
    const wait = this.lastResyncAt + this.resyncMinIntervalMs - Date.now();
    if (this.resyncTimer) {
      // Уже назначена на потом; срок подошёл раньше (интервал уменьшен) — сейчас.
      if (wait > 0) return;
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (wait > 0) {
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = null;
        if (this.leader) this.resync();
      }, wait);
      this.resyncTimer.unref();
      return;
    }
    this.lastResyncAt = Date.now();
    this.resyncing = (this.flushing ?? Promise.resolve())
      .then(() => this.router.resyncAll())
      .catch((err: unknown) => this.logger.error({ err }, 'Live feed: resync failed'))
      .finally(() => {
        this.resyncing = null;
        if (this.buffer.length && !this.flushTimer) this.flush();
      });
  }

  private async release(): Promise<void> {
    if (!this.leader) return;
    this.leader = false;
    await this.redis.eval(RELEASE_SCRIPT, 1, LEADER_KEY, this.nodeId).catch(() => undefined);
  }

  private onNotification(n: Notification): void {
    if (!this.leader || n.channel !== LIVE_PG_CHANNEL) return;
    const row = parseChange(n.payload);
    if (!row) return;
    this.buffer.push(row);
    if (this.buffer.length >= BATCH_MAX) {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, BATCH_WINDOW_MS);
    }
  }

  /** Пачки публикуются по одной, по порядку прихода. */
  private flush(): void {
    // Идёт публикация или пересинхронизация: следующую пачку заберёт их завершение (finally).
    if (this.flushing || this.resyncing) return;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return;
    this.flushing = this.router
      .handle(batch)
      .catch((err: unknown) => this.logger.error({ err }, 'Live feed: publication failed'))
      .finally(() => {
        this.flushing = null;
        if (this.buffer.length && !this.flushTimer) this.flush();
      });
  }
}
