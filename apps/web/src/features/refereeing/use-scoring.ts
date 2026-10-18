'use client';
// Очередь команд планшета ковра (план Phase 7a, §2, §5): события уходят по одному, по порядку; у каждого — свой
// ключ идемпотентности, повтор после обрыва связи — с тем же ключом и тем же телом (сервер не создаст дубль).
// expectedSeq фиксируется при первой отправке: это номер последнего подтверждённого события. Пока команды не
// отправлены, счёт на экране — предпросмотр тем же редьюсером, что на сервере (packages/contracts/scoring.ts).
// Отказ по правилам или чужое изменение (второй планшет) — очередь сбрасывается, журнал загружается заново.
// Неотправленные команды переживают перезагрузку страницы (хранилище вкладки).
import {
  type CabinetRole,
  type DataEnvelope,
  lastVoidableEvent,
  type MatchDetailDto,
  type Me,
  type MatchEventResultDto,
  type MatchState,
  replayEvents,
  type ScoringEvent,
  type ScoringRules,
} from '@sde/contracts';
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { fetchEvents } from './api';
import {
  commandRequest,
  DEVICE_ID,
  type EventInput,
  fromServer,
  isTemp,
  isTransient,
  loadQueue,
  localizeTimes,
  type LogEvent,
  maxSeq,
  mergeLog,
  type Pending,
  planUndo,
  relink,
  saveQueue,
  TEMP,
  uuid,
} from './scoring-queue';

export type { EventInput, Pending } from './scoring-queue';
export { commandRequest, isTransient, planUndo, relink, uuid } from './scoring-queue';

export interface ScoringNotice {
  /** `role` (0.13.1): в этой сессии выбрана другая роль кабинета — очередь не сбрасывается, а ждёт возврата. */
  kind: 'reset' | 'rejected' | 'role';
  /** Для `role`: роль, в которой открыт планшет (в неё вернуться). */
  role?: CabinetRole;
  count?: number;
  reason?: unknown;
  error?: unknown;
}

/** Есть отправленная, но не подтверждённая команда: журнал сейчас не перезагружаем (её номер уже зафиксирован). */
const inFlight = (queue: readonly Pending[]): boolean => queue.some((p) => p.sentSeq !== null);

/**
 * Журнал схватки: целиком при смене схватки и после сброса очереди, дальше — догрузка после последнего известного
 * события. Пока команда в пути, загрузка откладывается и выполняется, когда очередь опустеет.
 */
function useEventLog(match: MatchDetailDto | null, pendingRef: MutableRefObject<Pending[]>) {
  const matchId = match?.id ?? null;
  const serverSeq = match?.seq ?? 0;
  const [log, setLog] = useState<LogEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const logRef = useRef<LogEvent[]>([]);
  const loadedFor = useRef<string | null>(null);
  const shownFor = useRef<string | null>(null);
  const skipped = useRef(false);
  const setConfirmed = useCallback((next: LogEvent[]) => {
    logRef.current = next;
    setLog(next);
  }, []);
  const sync = useCallback(
    async (id: string, seq: number) => {
      if (inFlight(pendingRef.current)) {
        skipped.current = true;
        return;
      }
      const full = loadedFor.current !== id;
      const after = full ? 0 : maxSeq(logRef.current);
      if (!full && seq <= after) return;
      const data = await fetchEvents(id, after);
      if (shownFor.current !== id) return;
      // События неизменны: слияние по id не теряет подтверждённое, пока шёл запрос.
      setConfirmed(mergeLog(logRef.current, data.events.map(fromServer)));
      loadedFor.current = id;
      setLoaded(true);
    },
    [pendingRef, setConfirmed],
  );
  useEffect(() => {
    if (!matchId) return;
    if (shownFor.current !== matchId) {
      shownFor.current = matchId;
      loadedFor.current = null;
      setLoaded(false);
      setConfirmed([]);
    }
    void sync(matchId, serverSeq).catch(() => undefined);
  }, [matchId, serverSeq, tick, sync, setConfirmed]);
  const control = useMemo(
    () => ({
      /** Журнал заново (после сброса очереди: чужое изменение или отказ). */
      reload: () => {
        loadedFor.current = null;
        setLoaded(false);
        setTick((t) => t + 1);
      },
      /** Очередь опустела: выполнить отложенную загрузку. */
      afterDrain: () => {
        if (!skipped.current) return;
        skipped.current = false;
        setTick((t) => t + 1);
      },
      /** Повторить загрузку (команда ждёт журнал). */
      nudge: () => setTick((t) => t + 1),
      ready: () => loadedFor.current !== null && loadedFor.current === shownFor.current,
    }),
    [],
  );
  return { log, logRef, loaded, setConfirmed, ...control };
}

type EventLog = ReturnType<typeof useEventLog>;

interface QueueDeps {
  matchId: string | null;
  pendingRef: MutableRefObject<Pending[]>;
  events: EventLog;
  onChanged: () => void;
  /** Роль кабинета сессии при открытии планшета (0.13.1). */
  openedIn: CabinetRole | null;
}

/**
 * Отказ (403/404) — из-за смены роли кабинета в этой сессии после открытия планшета (например, во второй вкладке
 * выбрали «Представитель»)? Тогда оценки не теряются: очередь ждёт возврата в прежнюю роль (0.13.1).
 */
async function roleSwitchedAway(e: unknown, openedIn: CabinetRole | null): Promise<boolean> {
  if (!openedIn || !(e instanceof ApiError) || (e.status !== 403 && e.status !== 404)) return false;
  try {
    const me = (await api<DataEnvelope<Me>>('/me')).data;
    return me.activeRole !== openedIn && me.availableRoles.includes(openedIn);
  } catch {
    return false;
  }
}

/**
 * После ошибки отправки: `null` — повторить позже (нет связи); иначе — уведомление: сброс очереди (второй планшет
 * записал раньше), пауза (в сессии выбрана другая роль кабинета — очередь цела) или отказ.
 */
async function afterFailure(
  e: unknown,
  pending: number,
  openedIn: CabinetRole | null,
): Promise<ScoringNotice | null> {
  if (isTransient(e)) return null;
  if (e instanceof ApiError && e.code === 'EXPECTED_SEQ_MISMATCH') return { kind: 'reset', count: pending };
  if (openedIn && (await roleSwitchedAway(e, openedIn)))
    return { kind: 'role', count: pending, role: openedIn };
  return { kind: 'rejected', reason: e instanceof ApiError ? e.details?.reason : undefined, error: e };
}

/** Отправка одной команды; итог — продолжать ли очередь. `notify` — уведомление (пауза очередь не сбрасывает). */
function useSendHead(
  { matchId, pendingRef, events, openedIn }: QueueDeps,
  setQueue: (next: Pending[]) => void,
  setOffline: (v: boolean) => void,
  notify: (n: ScoringNotice) => void,
  scheduleRetry: () => void,
) {
  const { logRef, setConfirmed, ready, nudge } = events;
  return useCallback(
    async (head: Pending): Promise<boolean> => {
      if (!matchId) return false;
      if (head.sentSeq === null && !ready()) {
        // Номер команды — по загруженному журналу: ждём его (после сброса или при открытии планшета).
        nudge();
        scheduleRetry();
        return false;
      }
      if (head.preview.voidsEventId && isTemp(head.preview.voidsEventId)) {
        notify({ kind: 'rejected', reason: 'event_not_found' });
        return false;
      }
      if (head.sentSeq === null) {
        head.sentSeq = maxSeq(logRef.current);
        setQueue([...pendingRef.current]);
      }
      const { path, body } = commandRequest(matchId, head.preview, head.sentSeq, DEVICE_ID);
      try {
        const res = await api<DataEnvelope<MatchEventResultDto>>(path, {
          method: 'POST',
          body,
          idempotencyKey: head.key,
        });
        setOffline(false);
        const event = fromServer(res.data.event);
        setConfirmed(mergeLog(logRef.current, [event]));
        setQueue(relink(pendingRef.current.slice(1), head.preview.id, event.id));
        return true;
      } catch (e) {
        const notice = await afterFailure(e, pendingRef.current.length, openedIn);
        setOffline(notice === null); // ответ сервера был — связь есть
        if (notice) notify(notice);
        else scheduleRetry();
        return false;
      }
    },
    [
      matchId,
      pendingRef,
      logRef,
      setConfirmed,
      ready,
      nudge,
      setQueue,
      setOffline,
      notify,
      scheduleRetry,
      openedIn,
    ],
  );
}

/**
 * Последовательная отправка очереди с повтором при обрыве связи. `notify` — уведомление; кроме паузы (смена роли —
 * очередь цела) — сброс очереди и перезагрузка журнала.
 */
function useCommandQueue(deps: QueueDeps) {
  const { matchId, pendingRef, events, onChanged } = deps;
  const { reload, afterDrain } = events;
  const [pending, setPending] = useState<Pending[]>([]);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<ScoringNotice | null>(null);
  const busy = useRef(false);
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);
  const { scheduleRetry, resetBackoff } = useRetry(pumpRef);
  const setQueue = useCallback(
    (next: Pending[]) => {
      pendingRef.current = next;
      setPending(next);
      if (matchId) saveQueue(matchId, next);
    },
    [matchId, pendingRef],
  );
  const notify = useCallback(
    (n: ScoringNotice) => {
      setNotice(n);
      if (n.kind === 'role') return;
      setQueue([]);
      reload();
      onChanged();
    },
    [onChanged, reload, setQueue],
  );
  const sendHead = useSendHead(deps, setQueue, setOffline, notify, scheduleRetry);
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      for (let head = pendingRef.current[0]; head; head = pendingRef.current[0]) {
        if (!(await sendHead(head))) return;
        resetBackoff();
      }
      afterDrain();
      onChanged();
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [afterDrain, onChanged, pendingRef, sendHead, resetBackoff]);
  pumpRef.current = pump;
  useRestoreQueue(matchId, pendingRef, setQueue, pumpRef);
  return { pending, setQueue, offline, sending, notice, setNotice, pump };
}

/** Повтор отправки очереди после обрыва связи: пауза растёт до 10 с, после удачной отправки — снова 1 с. */
function useRetry(pumpRef: MutableRefObject<() => Promise<void>>) {
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(1000);
  const scheduleRetry = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => void pumpRef.current(), backoff.current);
    backoff.current = Math.min(10_000, backoff.current * 2);
  }, [pumpRef]);
  const resetBackoff = useCallback(() => {
    backoff.current = 1000;
  }, []);
  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );
  return { scheduleRetry, resetBackoff };
}

/** Команды, не отправленные до перезагрузки страницы, — снова в очередь с теми же ключами. */
function useRestoreQueue(
  matchId: string | null,
  pendingRef: MutableRefObject<Pending[]>,
  setQueue: (next: Pending[]) => void,
  pumpRef: MutableRefObject<() => Promise<void>>,
): void {
  useEffect(() => {
    if (!matchId) return;
    const saved = loadQueue(matchId);
    if (saved.length > 0 && pendingRef.current.length === 0) {
      setQueue(saved);
      void pumpRef.current();
    }
  }, [matchId, pendingRef, setQueue, pumpRef]);
}

/** Новая команда (в очередь и на отправку) и «Отменить последнее». */
function useQueueActions(
  logRef: MutableRefObject<LogEvent[]>,
  pendingRef: MutableRefObject<Pending[]>,
  q: Pick<ReturnType<typeof useCommandQueue>, 'setQueue' | 'setNotice' | 'pump'>,
) {
  const { setQueue, setNotice, pump } = q;
  const enqueue = useCallback(
    (input: EventInput | { voidsEventId: string; matchClockMs: number }) => {
      const isVoid = 'voidsEventId' in input;
      const preview: ScoringEvent = {
        id: `${TEMP}${uuid()}`,
        seq: maxSeq([...logRef.current, ...pendingRef.current.map((p) => p.preview)]) + 1,
        type: isVoid ? 'EVENT_VOIDED' : input.type,
        side: isVoid ? null : input.side,
        actionCode: isVoid ? null : input.actionCode,
        value: isVoid ? null : input.value,
        matchClockMs: input.matchClockMs,
        deviceTime: new Date().toISOString(),
        voidsEventId: isVoid ? input.voidsEventId : null,
      };
      setNotice(null);
      setQueue([...pendingRef.current, { key: uuid(), preview, sentSeq: null }]);
      void pump();
    },
    [logRef, pendingRef, pump, setNotice, setQueue],
  );
  const undo = useCallback(
    (matchClockMs: number) => {
      const plan = planUndo(logRef.current, pendingRef.current);
      if (!plan) return;
      if (plan.drop.length > 0) setQueue(pendingRef.current.filter((p) => !plan.drop.includes(p.preview.id)));
      if (plan.voidId) enqueue({ voidsEventId: plan.voidId, matchClockMs });
    },
    [enqueue, logRef, pendingRef, setQueue],
  );
  return { enqueue, undo };
}

/** Не уйти со страницы с неотправленными командами незаметно (закрытие вкладки — команды пропадут). */
function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/**
 * @param serverOffsetMs сдвиг часов сервера относительно планшета (сервер − планшет): время чужих устройств
 *   сводится к часам этого планшета, чтобы секундомер и удержание шли одинаково на всех планшетах.
 */
export function useScoring(
  match: MatchDetailDto | null,
  rules: ScoringRules | null,
  onChanged: () => void,
  serverOffsetMs = 0,
) {
  const durationMs = (match?.durationSeconds ?? 0) * 1000;
  const pendingRef = useRef<Pending[]>([]);
  const events = useEventLog(match, pendingRef);
  const { logRef } = events;
  // Роль, в которой открыт планшет: «я» загружено каркасом до показа экрана.
  const queryClient = useQueryClient();
  const [openedIn] = useState<CabinetRole | null>(
    () => queryClient.getQueryData<Me>(qk.me)?.activeRole ?? null,
  );
  const q = useCommandQueue({ matchId: match?.id ?? null, pendingRef, events, onChanged, openedIn });
  const { setNotice } = q;
  useLeaveGuard(q.pending.length > 0);
  const all = useMemo<ScoringEvent[]>(
    () => [...localizeTimes(events.log, DEVICE_ID, serverOffsetMs), ...q.pending.map((p) => p.preview)],
    [events.log, q.pending, serverOffsetMs],
  );
  const state: MatchState | null = useMemo(
    () => (rules && match?.state ? replayEvents(all, rules, durationMs) : (match?.state ?? null)),
    [all, rules, durationMs, match?.state],
  );
  const { enqueue, undo } = useQueueActions(logRef, pendingRef, q);
  /** Событие записано этим планшетом (или ещё в очереди): автоматические события шлёт тот, кто запустил время. */
  const isOwn = useCallback(
    (id: string): boolean =>
      isTemp(id) || logRef.current.some((e) => e.id === id && e.deviceId === DEVICE_ID),
    [logRef],
  );
  return {
    state,
    log: all,
    /** Журнал загружен: номер команд и результата — по нему. */
    loaded: events.loaded,
    pendingCount: q.pending.length,
    inFlight: q.sending,
    offline: q.offline,
    notice: q.notice,
    clearNotice: () => setNotice(null),
    /** Роль вернули: убрать уведомление о паузе и продолжить отправку очереди (0.13.1). */
    resume: () => {
      setNotice(null);
      void q.pump();
    },
    enqueue,
    undo,
    isOwn,
    /** Что отменит «Отменить последнее». */
    undoTarget: lastVoidableEvent(all),
    /** Последнее событие журнала, который видит бригада, — expectedSeq для результата. */
    serverSeq: maxSeq(events.log),
  };
}
