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
import { type ChannelHealth, LiveClient, type LiveEvent, type LiveStatus } from './live-client';

let client: LiveClient | null = null;

export function liveClient(): LiveClient {
  client ??= new LiveClient({
    createSocket: () =>
      io(LIVE_NAMESPACE, {
        path: LIVE_PATH,
        addTrailingSlash: false,
        // Сначала WebSocket; где он закрыт (прокси, сеть зала) — long polling. Без tryAllTransports
        // engine.io-client после неудачи WebSocket следующий транспорт не пробует.
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
        withCredentials: true,
        reconnectionDelayMax: 10_000,
      }),
    refresh: refreshSession,
  });
  return client;
}

/** Закрыть соединение: выход и вход (соединение не должно пережить смену пользователя во вкладке). */
export function closeLive(): void {
  client?.close();
}

/** Состояние соединения: «online» — данные приходят сразу. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (fn) => liveClient().onStatus(fn),
    () => liveClient().status,
    () => 'connecting',
  );
}

/** Здоровье канала экрана (`live` — изменения приходят сразу; `down` — связи нет или подписка отклонена). */
export function useChannelHealth(channel: string | null): ChannelHealth {
  return useSyncExternalStore(
    (fn) => liveClient().onStatus(fn),
    () => (channel ? liveClient().channelHealth(channel) : 'down'),
    () => 'pending',
  );
}

/**
 * Интервал запасного опроса экрана, который обновляется по каналу `channel`: пока канал работает — `onlineMs`
 * (по умолчанию раз в минуту; не чаще, чем экран опрашивает без связи), иначе — прежний интервал экрана.
 */
export function useLiveInterval(channel: string | null, offlineMs: number, onlineMs = 60_000): number {
  return useChannelHealth(channel) === 'live' ? Math.max(offlineMs, onlineMs) : offlineMs;
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
/** Что обновить: запросы с этим префиксом ключа или (`exact`) ровно этот запрос. */
export type LiveTarget = QueryKey | { exact: QueryKey };

export function useLiveInvalidate(
  channel: string | null,
  keysFor: (payload: LiveChangedPayload | null) => LiveTarget[],
): void {
  const qc = useQueryClient();
  const pending = useRef<{ keys: LiveTarget[]; timer: ReturnType<typeof setTimeout> | null }>({
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
      for (const target of keys) {
        const id = JSON.stringify(target);
        if (seen.has(id)) continue;
        seen.add(id);
        if ('exact' in target) void qc.invalidateQueries({ queryKey: target.exact, exact: true });
        else void qc.invalidateQueries({ queryKey: target });
      }
    }, 250);
  });
}

const DAY_TOPICS: readonly LiveTopic[] = ['matches', 'schedule', 'crews', 'results', 'draws', 'categories'];

/**
 * Разделы турнира (`['competitions', id, раздел]`), которые затрагивает тема. Изменения турнира и участий
 * затрагивают всё. Взвешивание или прибытие не заставляют перечитывать «Судейство», а оценка — экран взвешивания.
 */
const TOPIC_SECTIONS: Record<Exclude<LiveTopic, 'competition' | 'registrations'>, readonly string[]> = {
  categories: ['categories', 'draws', 'results', 'entries', 'eligible', 'officiating'],
  admission: ['admission', 'entries', 'draws', 'check-in', 'weigh-in'],
  checkin: ['check-in', 'admission', 'weigh-in'],
  weighin: ['weigh-in', 'scales', 'weigh-in-windows', 'admission', 'entries'],
  draws: ['draws', 'categories', 'results', 'schedule', 'officiating', 'pending-confirmations'],
  schedule: ['schedule', 'sessions', 'mats', 'officiating', 'pending-confirmations'],
  crews: ['mat-assignments', 'crew-candidates', 'officiating'],
  matches: ['officiating', 'pending-confirmations', 'results', 'draws', 'schedule'],
  results: ['results', 'draws', 'categories'],
  rating: ['rating'],
};

/**
 * Запросы, которые затрагивает изменение турнира: карточка турнира (счётчики, статусы, доступные действия) и
 * разделы по темам; изменения дня соревнований — ещё ковры, схватки, сетки категорий и жеребьёвки; итоги — история
 * спортсменов. Обновляются только открытые экраны (TanStack Query перечитывает активные запросы, остальные
 * помечает устаревшими).
 */
export function competitionKeys(competitionId: string, payload: LiveChangedPayload | null): LiveTarget[] {
  const topics = new Set<LiveTopic>(payload?.topics ?? LIVE_TOPICS);
  const base = ['competitions', competitionId] as const;
  const keys: LiveTarget[] = [];
  if (topics.has('competition') || topics.has('registrations')) keys.push([...base]);
  else {
    keys.push({ exact: [...base] });
    const sections = new Set<string>();
    for (const t of topics)
      if (t in TOPIC_SECTIONS)
        for (const x of TOPIC_SECTIONS[t as keyof typeof TOPIC_SECTIONS]) sections.add(x);
    for (const x of sections) keys.push([...base, x]);
  }
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
