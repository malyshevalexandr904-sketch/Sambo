// Клиент живых каналов (Phase 8a; API.md, 7): одно соединение Socket.IO на вкладку, подписки по каналам с `seq`.
// Сообщения канала идут строго по порядку; пропуск или сброс счётчика (перезапуск Redis) — повторная подписка с
// `lastSeq`: каналы состояния отдают снимок, каналы изменений — сигнал «перечитать по REST». Пока подписка
// подтверждается, пришедшие сообщения копятся и применяются после ответа (лишние — по `seq`). После
// переподключения подписки восстанавливаются сами; истёк вход — сессия обновляется и соединение заводится заново.
import {
  LIVE_EVENTS,
  type LiveErrorCode,
  type LiveMessage,
  type LivePongAck,
  type LiveSubscribeAck,
} from '@sde/contracts';

/** Что получает подписчик канала. */
export type LiveEvent =
  /** Очередное сообщение канала по порядку. */
  | { kind: 'message'; message: LiveMessage }
  /** (Пере)подписка: что-то могло быть пропущено — применить снимок или перечитать данные. */
  | { kind: 'resync'; snapshot: LiveMessage | null }
  /** Подписка отклонена (нет прав, канал не найден). */
  | { kind: 'error'; code: LiveErrorCode };

export type LiveStatus = 'connecting' | 'online' | 'offline';

/** Минимум Socket.IO-клиента, который нужен здесь (подменяется в тестах). */
export interface LiveSocket {
  readonly connected: boolean;
  on(event: string, fn: (...args: never[]) => void): unknown;
  emit(event: string, payload: unknown, ack?: (res: never) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export interface LiveClientOptions {
  createSocket: () => LiveSocket;
  /** Обновить сессию (истёкший access token); true — можно подключаться снова. */
  refresh: () => Promise<boolean>;
  now?: () => number;
}

type Listener = (e: LiveEvent) => void;

interface ChannelState {
  listeners: Set<Listener>;
  /** Номер последнего применённого сообщения; null — подписки ещё не было. */
  seq: number | null;
  syncing: boolean;
  buffer: LiveMessage[];
  /** До этого момента сообщение с меньшим или равным `seq` — дубль после подписки, а не сброс счётчика. */
  graceUntil: number;
  error: LiveErrorCode | null;
  /** Последнее состояние канала состояния (снимок или сообщение) — для подписчика, пришедшего позже. */
  last: LiveMessage | null;
  /** Ответа на подписку нет слишком долго — повторить. */
  syncTimer: ReturnType<typeof setTimeout> | null;
  /** Номер попытки подписки: ответ на прежнюю попытку не применяется. */
  attempt: number;
}

/** Сообщения со старым номером в течение этого времени после подписки — дубли гонки «подписка ↔ публикация». */
const DUPLICATE_GRACE_MS = 3_000;
const PING_EVERY_MS = 30_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
const REAUTH_INTERVAL_MS = 30_000;
const STATE_TYPES = new Set(['mat.state', 'match.state']);

export class LiveClient {
  private socket: LiveSocket | null = null;
  private readonly channels = new Map<string, ChannelState>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private statusValue: LiveStatus = 'connecting';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private lastReauthAt = Number.NEGATIVE_INFINITY;
  /** Смещение часов: время сервера − время клиента (мс), по `ping`. */
  offsetMs = 0;
  private readonly now: () => number;

  constructor(private readonly opts: LiveClientOptions) {
    this.now = opts.now ?? Date.now;
  }

  get status(): LiveStatus {
    return this.statusValue;
  }

  /** Время сервера сейчас (для таймеров табло). */
  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  subscribe(channel: string, listener: Listener): () => void {
    let state = this.channels.get(channel);
    if (!state) {
      state = {
        listeners: new Set(),
        seq: null,
        syncing: false,
        buffer: [],
        graceUntil: 0,
        error: null,
        last: null,
        syncTimer: null,
        attempt: 0,
      };
      this.channels.set(channel, state);
    }
    state.listeners.add(listener);
    const socket = this.ensureSocket();
    if (state.listeners.size === 1 && socket.connected) this.sync(channel, state);
    else if (state.error) listener({ kind: 'error', code: state.error });
    else if (state.seq !== null && !state.syncing) listener({ kind: 'resync', snapshot: state.last });
    return () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.listeners.delete(listener);
      if (s.listeners.size > 0) return;
      if (s.syncTimer) clearTimeout(s.syncTimer);
      this.channels.delete(channel);
      if (this.socket?.connected) this.socket.emit(LIVE_EVENTS.unsubscribe, { channel });
    };
  }

  /** Закрыть соединение (выход из приложения, тесты). */
  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket?.disconnect();
    this.socket = null;
    this.channels.clear();
    this.setStatus('offline');
  }

  private setStatus(s: LiveStatus): void {
    if (this.statusValue === s) return;
    this.statusValue = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private ensureSocket(): LiveSocket {
    if (this.socket) return this.socket;
    const socket = this.opts.createSocket();
    this.socket = socket;
    socket.on('connect', () => {
      this.setStatus('online');
      this.ping();
      if (!this.pingTimer) this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
      for (const [channel, state] of this.channels) this.sync(channel, state);
    });
    socket.on('disconnect', (reason: string) => {
      this.setStatus('offline');
      for (const state of this.channels.values()) this.stopSync(state);
      // Сервер закрыл соединение сам — Socket.IO не переподключается без команды.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', () => this.setStatus('offline'));
    socket.on(LIVE_EVENTS.message, (m: LiveMessage) => this.onMessage(m));
    socket.on(LIVE_EVENTS.expired, () => void this.reauthenticate());
    return socket;
  }

  private ping(): void {
    const sentAt = this.now();
    this.socket?.emit(LIVE_EVENTS.ping, { clientTime: sentAt }, (ack: LivePongAck) => {
      const receivedAt = this.now();
      if (typeof ack?.serverTime === 'number')
        this.offsetMs = ack.serverTime - Math.round((sentAt + receivedAt) / 2);
    });
  }

  private canReauthenticate(): boolean {
    return this.now() - this.lastReauthAt > REAUTH_INTERVAL_MS;
  }

  /** Вход истёк: обновить сессию и подключиться заново (cookie нового access token уйдёт в рукопожатие). */
  private async reauthenticate(): Promise<void> {
    if (this.refreshing || !this.socket) return;
    this.refreshing = true;
    this.lastReauthAt = this.now();
    try {
      await this.opts.refresh();
    } finally {
      this.refreshing = false;
    }
    const socket = this.socket;
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }

  private stopSync(state: ChannelState): void {
    state.syncing = false;
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.syncTimer = null;
  }

  private sync(channel: string, state: ChannelState): void {
    if (!this.socket?.connected || state.syncing) return;
    state.syncing = true;
    state.buffer = [];
    const lastSeq = state.seq ?? undefined;
    state.attempt += 1;
    const attempt = state.attempt;
    state.syncTimer = setTimeout(() => {
      state.attempt += 1;
      this.stopSync(state);
      if (this.channels.get(channel) === state) this.sync(channel, state);
    }, SUBSCRIBE_TIMEOUT_MS);
    this.socket.emit(LIVE_EVENTS.subscribe, { channel, lastSeq }, (ack: LiveSubscribeAck) => {
      if (attempt !== state.attempt || this.channels.get(channel) !== state || !state.syncing) return;
      this.stopSync(state);
      if (!ack || !ack.ok) {
        const code = ack && !ack.ok ? ack.error.code : 'INTERNAL_ERROR';
        // Вход истёк или cookie уже нет (вкладка долго спала): обновить сессию и подключиться заново — не чаще
        // раза в полминуты, иначе отказ остаётся отказом.
        if ((code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED') && this.canReauthenticate()) {
          void this.reauthenticate();
          return;
        }
        state.error = code;
        for (const fn of state.listeners) fn({ kind: 'error', code });
        return;
      }
      state.error = null;
      const missed = lastSeq === undefined || ack.seq !== lastSeq || ack.snapshot !== null;
      state.seq = ack.seq;
      state.graceUntil = this.now() + DUPLICATE_GRACE_MS;
      if (ack.snapshot) state.last = ack.snapshot;
      if (missed) for (const fn of state.listeners) fn({ kind: 'resync', snapshot: ack.snapshot });
      const buffered = state.buffer.sort((a, b) => a.seq - b.seq);
      state.buffer = [];
      for (const m of buffered) this.apply(channel, state, m);
    });
  }

  private onMessage(m: LiveMessage): void {
    const state = this.channels.get(m.channel);
    if (!state) return;
    if (state.syncing || state.seq === null) {
      state.buffer.push(m);
      return;
    }
    this.apply(m.channel, state, m);
  }

  private apply(channel: string, state: ChannelState, m: LiveMessage): void {
    const seq = state.seq ?? 0;
    if (m.seq === seq + 1) {
      state.seq = m.seq;
      if (STATE_TYPES.has(m.type)) state.last = m;
      for (const fn of state.listeners) fn({ kind: 'message', message: m });
      return;
    }
    if (m.seq <= seq && this.now() < state.graceUntil) return;
    // Пропуск или сброс счётчика канала: переподписаться с последним номером.
    this.sync(channel, state);
  }
}
