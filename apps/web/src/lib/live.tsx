'use client';
// Живые данные в интерфейсе (Phase 8a): одно соединение на вкладку (ленивое — при первой подписке), подписки
// экранов на каналы и обновление запросов TanStack Query по сообщениям. Опрос остаётся запасным: пока соединение
// живо — редкий, без связи — прежний интервал экрана.
import {
  LIVE_NAMESPACE,
  LIVE_PATH,
  LIVE_TOPICS,
  liveChannel,
  type LiveChangedPayload,
  type LiveTopic,
} from '@sde/contracts';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { refreshSession } from './api';
import { LiveClient, type LiveEvent, type LiveStatus } from './live-client';

let client: LiveClient | null = null;

export function liveClient(): LiveClient {
  client ??= new LiveClient({
    createSocket: () =>
      io(LIVE_NAMESPACE, {
        path: LIVE_PATH,
        addTrailingSlash: false,
        // Сначала WebSocket; где он закрыт (прокси, сеть зала) — long polling.
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionDelayMax: 10_000,
      }),
    refresh: refreshSession,
  });
  return client;
}

/** Состояние соединения: «online» — данные приходят сразу. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (fn) => liveClient().onStatus(fn),
    () => liveClient().status,
    () => 'connecting',
  );
}

/**
 * Интервал запасного опроса: при живом соединении — `onlineMs` (по умолчанию раз в минуту; не чаще, чем экран
 * опрашивает без связи), без связи — прежний интервал экрана.
 */
export function useLiveInterval(offlineMs: number, onlineMs = 60_000): number {
  const status = useLiveStatus();
  return status === 'online' ? Math.max(offlineMs, onlineMs) : offlineMs;
}

/** Подписка экрана на канал; `channel = null` — без подписки. */
export function useLiveChannel(channel: string | null, onEvent: (e: LiveEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!channel) return;
    return liveClient().subscribe(channel, (e) => handler.current(e));
  }, [channel]);
}

/**
 * Канал изменений → обновить запросы. Сообщения за 250 мс складываются в одно обновление; после пропуска
 * (`resync`) обновляется всё, что канал покрывает.
 */
export function useLiveInvalidate(
  channel: string | null,
  keysFor: (payload: LiveChangedPayload | null) => QueryKey[],
): void {
  const qc = useQueryClient();
  const pending = useRef<{ keys: QueryKey[]; timer: ReturnType<typeof setTimeout> | null }>({
    keys: [],
    timer: null,
  });
  const keysRef = useRef(keysFor);
  keysRef.current = keysFor;
  useEffect(
    () => () => {
      if (pending.current.timer) clearTimeout(pending.current.timer);
    },
    [],
  );
  useLiveChannel(channel, (e) => {
    if (e.kind === 'error') return;
    const payload = e.kind === 'message' ? (e.message.payload as LiveChangedPayload) : null;
    const p = pending.current;
    p.keys.push(...keysRef.current(payload));
    if (p.timer) return;
    p.timer = setTimeout(() => {
      const keys = p.keys;
      p.keys = [];
      p.timer = null;
      const seen = new Set<string>();
      for (const queryKey of keys) {
        const id = JSON.stringify(queryKey);
        if (seen.has(id)) continue;
        seen.add(id);
        void qc.invalidateQueries({ queryKey });
      }
    }, 250);
  });
}

const DAY_TOPICS: readonly LiveTopic[] = ['matches', 'schedule', 'crews', 'results', 'draws', 'categories'];

/**
 * Запросы, которые затрагивает изменение турнира: всё под `['competitions', id]`, а изменения дня соревнований —
 * ещё ковры, схватки, сетки категорий и жеребьёвки; итоги — история спортсменов. Обновляются только открытые
 * экраны (TanStack Query перечитывает активные запросы, остальные помечает устаревшими).
 */
export function competitionKeys(competitionId: string, payload: LiveChangedPayload | null): QueryKey[] {
  const topics = new Set<LiveTopic>(payload?.topics ?? LIVE_TOPICS);
  const keys: QueryKey[] = [['competitions', competitionId]];
  if (DAY_TOPICS.some((t) => topics.has(t))) keys.push(['mats'], ['matches'], ['categories'], ['draws']);
  if (topics.has('results')) keys.push(['athletes']);
  if (topics.has('registrations') || topics.has('admission'))
    keys.push(['applications'], ['me', 'applications']);
  return keys;
}

/** Канал турнира для персонала: экраны турнира, «Судейство», итоги, сетки — обновляются сами. */
export function useCompetitionLive(competitionId: string | null): void {
  useLiveInvalidate(competitionId ? liveChannel.opsCompetition(competitionId) : null, (p) =>
    competitionId ? competitionKeys(competitionId, p) : [],
  );
}
