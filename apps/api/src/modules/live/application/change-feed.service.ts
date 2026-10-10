// Лента изменений для живых данных (Phase 8a; ARCHITECTURE.md, 13): уведомления PostgreSQL `sde_live` (триггер на
// журнале синхронизации, приходят только после commit) → пачки → LiveRouterService. Узлов api может быть
// несколько: публикует ведущий (блокировка в Redis с продлением), раздают сообщения все. Пока ведущий
// меняется, сообщения могут потеряться — экраны догонят запасным опросом.
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
    const str = (k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null);
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
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flushing?.catch(() => undefined);
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
    return this.leader;
  }

  /** Дождаться публикации накопленных изменений (тесты и плавная остановка). */
  async drain(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flush();
    }
    while (this.flushing) await this.flushing;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.env.DATABASE_URL, application_name: 'sde-live' });
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

  private async leadership(): Promise<void> {
    if (this.stopped) return;
    try {
      if (!this.listening) {
        if (this.leader) await this.release();
        return;
      }
      if (this.leader) {
        const renewed = await this.redis.eval(RENEW_SCRIPT, 1, LEADER_KEY, this.nodeId, LEADER_TTL_MS);
        if (Number(renewed) !== 1) {
          this.leader = false;
          this.logger.warn('Live feed: leadership lost');
        }
        return;
      }
      const acquired = await this.redis.set(LEADER_KEY, this.nodeId, 'PX', LEADER_TTL_MS, 'NX');
      if (acquired === 'OK') {
        this.leader = true;
        this.router.reset();
        this.logger.log('Live feed: this node publishes live updates');
      }
    } catch (err) {
      this.logger.warn({ err }, 'Live feed: leadership check failed');
    }
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
    // Идёт публикация: следующую пачку заберёт её завершение (finally ниже).
    if (this.flushing) return;
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
