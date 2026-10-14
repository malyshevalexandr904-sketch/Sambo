// Сброс кэша публичных ответов по событию (Phase 8b; план §4): сервер web держит одно соединение с живыми данными
// api и слушает канал `public:competitions` — slug и темы каждого изменения опубликованного турнира. Модуль
// работает только на сервере web (Node.js); состояние — в globalThis: одно соединение на процесс, сколько бы раз
// Next.js ни загрузил модуль (слои сборки, перезагрузка в разработке).
import {
  LIVE_EVENTS,
  LIVE_NAMESPACE,
  LIVE_PATH,
  liveChannel,
  type LiveCompetitionChangedPayload,
  type LiveMessage,
  type LiveSubscribeAck,
} from '@sde/contracts';
import { io } from 'socket.io-client';

/** Сброс: slug — записи турнира; null — всё (пропущенные сообщения, переподключение). */
export type Invalidate = (slug: string | null, topics: readonly string[]) => void;

interface FeedState {
  ready: boolean;
  lastSeq: number | null;
  close: () => void;
}

const g = globalThis as typeof globalThis & { __sdePublicCacheFeed?: FeedState };

/** Соединение подписано и сообщения идут подряд: кэш сбрасывается по событиям. */
export function publicFeedReady(): boolean {
  return g.__sdePublicCacheFeed?.ready === true;
}

/**
 * Сообщение канала: номера идут подряд — сбросить записи турнира; пропуск — сбросить всё. Возвращает новый
 * последний номер.
 */
export function applyFeedMessage(m: LiveMessage, lastSeq: number | null, invalidate: Invalidate): number {
  if (lastSeq !== null && m.seq !== lastSeq + 1) invalidate(null, []);
  else {
    const p = m.payload as Partial<LiveCompetitionChangedPayload>;
    if (typeof p.slug === 'string' && Array.isArray(p.topics)) invalidate(p.slug, p.topics);
    else invalidate(null, []);
  }
  return m.seq;
}

export function startPublicCacheFeed(apiUrl: string, invalidate: Invalidate): void {
  if (g.__sdePublicCacheFeed || typeof window !== 'undefined') return;
  const socket = io(`${apiUrl}${LIVE_NAMESPACE}`, {
    path: LIVE_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    reconnectionDelayMax: 30_000,
  });
  const state: FeedState = { ready: false, lastSeq: null, close: () => socket.close() };
  g.__sdePublicCacheFeed = state;
  let retry = 1_000;
  socket.on('connect', () => {
    socket.emit(
      LIVE_EVENTS.subscribe,
      { channel: liveChannel.publicCompetitions },
      (ack: LiveSubscribeAck) => {
        if (!ack.ok) return;
        retry = 1_000;
        state.lastSeq = ack.seq;
        state.ready = true;
        // Пока соединения не было, турниры могли измениться.
        invalidate(null, []);
      },
    );
  });
  socket.on('disconnect', () => {
    state.ready = false;
  });
  // Отказ при подключении (api перезапускается, сбой проверки) socket.io-client сам не повторяет.
  socket.on('connect_error', () => {
    state.ready = false;
    if (socket.active) return;
    setTimeout(() => socket.connect(), retry).unref?.();
    retry = Math.min(retry * 2, 30_000);
  });
  socket.on(LIVE_EVENTS.message, (m: LiveMessage) => {
    if (m.channel !== liveChannel.publicCompetitions) return;
    state.lastSeq = applyFeedMessage(m, state.lastSeq, invalidate);
  });
}
