'use client';
// Очередь команд планшета ковра (план Phase 7a, §2, §5): события уходят по одному, по порядку; у каждого — свой
// ключ идемпотентности, повтор после обрыва связи — с тем же ключом и тем же телом (сервер не создаст дубль).
// expectedSeq фиксируется при первой отправке: это номер последнего подтверждённого события. Пока команды не
// отправлены, счёт на экране — предпросмотр тем же редьюсером, что на сервере (packages/contracts/scoring.ts).
// Отказ по правилам или чужое изменение (второй планшет) — очередь сбрасывается, экран обновляется с сервера.
import {
  type DataEnvelope,
  excludedEventIds,
  lastVoidableEvent,
  type MatchDetailDto,
  type MatchEventResultDto,
  type MatchState,
  replayEvents,
  type ScoringEvent,
  type ScoringRules,
} from '@sde/contracts';
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { fetchEvents, toScoring } from './api';

/** UUID v4 и без безопасного контекста (планшет в локальной сети узла по http). */
export function uuid(): string {
  // randomUUID есть только в безопасном контексте (https или localhost); getRandomValues — везде.
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function' && globalThis.isSecureContext) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Устройство — вкладка планшета: для журнала (кто записал с какого устройства). */
const DEVICE_ID = typeof window === 'undefined' ? 'server' : `tablet-${uuid().slice(0, 8)}`;

export type EventInput = Pick<ScoringEvent, 'type' | 'side' | 'actionCode' | 'value' | 'matchClockMs'>;

export interface Pending {
  key: string;
  preview: ScoringEvent;
  /** Номер последнего события, на котором основана команда; задаётся при первой отправке и не меняется. */
  sentSeq: number | null;
}

export interface ScoringNotice {
  kind: 'reset' | 'rejected';
  count?: number;
  reason?: unknown;
  error?: unknown;
}

const TEMP = 'local:';
export const isTemp = (id: string): boolean => id.startsWith(TEMP);
const maxSeq = (events: readonly ScoringEvent[], floor = 0): number =>
  events.reduce((m, e) => Math.max(m, e.seq), floor);

/** Сеть недоступна или сервер не ответил: команду повторяем с тем же ключом. */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  if (e.code === 'NETWORK' || e.status >= 500 || e.code === 'RATE_LIMITED') return true;
  return e.code === 'IDEMPOTENCY_KEY_REUSED' && e.details?.inProgress === true;
}

/** Запрос команды: путь и тело. Тело одинаково при каждом повторе — так сервер узнаёт повтор по ключу. */
export function commandRequest(
  matchId: string,
  p: ScoringEvent,
  expectedSeq: number,
  deviceId: string,
): { path: string; body: Record<string, unknown> } {
  const meta = { expectedSeq, matchClockMs: p.matchClockMs, deviceTime: p.deviceTime, deviceId };
  if (p.type === 'EVENT_VOIDED') {
    return { path: `/matches/${matchId}/events/${p.voidsEventId as string}/void`, body: meta };
  }
  return {
    path: `/matches/${matchId}/events`,
    body: {
      ...meta,
      type: p.type,
      ...(p.side ? { side: p.side } : {}),
      ...(p.actionCode ? { actionCode: p.actionCode } : {}),
      ...(p.value !== null ? { value: p.value } : {}),
    },
  };
}

/**
 * «Отменить последнее»: что убрать из очереди на месте и что отменить на сервере. Ещё не отправленное событие
 * убирается из очереди; отправленное (или отправляемое сейчас, в том числе без связи) — отменяется компенсирующим
 * событием, ссылка с временного номера на серверный заменяется, когда событие подтвердится. Конец удержания
 * отменяется вместе с началом (как на сервере: отмена половины удержания отменяет его целиком).
 */
export function planUndo(
  confirmed: readonly ScoringEvent[],
  queue: readonly Pending[],
): { drop: string[]; voidId: string | null } | null {
  const all = [...confirmed, ...queue.map((p) => p.preview)];
  const target = lastVoidableEvent(all);
  if (!target) return null;
  const unsent = (id: string): boolean => queue.some((p) => p.preview.id === id && p.sentSeq === null);
  if (!unsent(target.id)) return { drop: [], voidId: target.id };
  if (target.type !== 'HOLD_ENDED') return { drop: [target.id], voidId: null };
  const excluded = excludedEventIds(all);
  const start = all
    .filter(
      (e) => e.type === 'HOLD_STARTED' && e.side === target.side && e.seq < target.seq && !excluded.has(e.id),
    )
    .at(-1);
  if (!start) return { drop: [target.id], voidId: null };
  return unsent(start.id)
    ? { drop: [target.id, start.id], voidId: null }
    : { drop: [target.id], voidId: start.id };
}

/** Событие подтверждено сервером: ссылки отмен в очереди — с временного номера на серверный. */
export function relink(queue: readonly Pending[], tempId: string, serverId: string): Pending[] {
  return queue.map((p) =>
    p.preview.voidsEventId === tempId ? { ...p, preview: { ...p.preview, voidsEventId: serverId } } : p,
  );
}

/** Журнал схватки: целиком при смене схватки, дальше — догрузка после последнего известного события. */
function useEventLog(match: MatchDetailDto | null, pendingRef: MutableRefObject<Pending[]>) {
  const matchId = match?.id ?? null;
  const serverSeq = match?.seq ?? 0;
  const [log, setLog] = useState<ScoringEvent[]>([]);
  const logRef = useRef<ScoringEvent[]>([]);
  const loadedFor = useRef<string | null>(null);
  const setConfirmed = useCallback((next: ScoringEvent[]) => {
    logRef.current = next;
    setLog(next);
  }, []);
  const sync = useCallback(
    async (id: string, seq: number) => {
      if (pendingRef.current.length > 0) return;
      const fresh = loadedFor.current !== id;
      const after = fresh ? 0 : maxSeq(logRef.current);
      if (!fresh && seq <= after) return;
      const data = await fetchEvents(id, after);
      if (pendingRef.current.length > 0) return;
      loadedFor.current = id;
      const base = fresh ? [] : logRef.current;
      const known = new Set(base.map((e) => e.id));
      setConfirmed([...base, ...data.events.map(toScoring).filter((e) => !known.has(e.id))]);
    },
    [pendingRef, setConfirmed],
  );
  useEffect(() => {
    if (!matchId) return;
    if (loadedFor.current !== matchId) setConfirmed([]);
    void sync(matchId, serverSeq).catch(() => undefined);
  }, [matchId, serverSeq, sync, setConfirmed]);
  const reload = useCallback(() => {
    loadedFor.current = null;
  }, []);
  return { log, logRef, setConfirmed, reload };
}

interface QueueDeps {
  matchId: string | null;
  pendingRef: MutableRefObject<Pending[]>;
  logRef: MutableRefObject<ScoringEvent[]>;
  setConfirmed: (next: ScoringEvent[]) => void;
  reload: () => void;
  onChanged: () => void;
}

/** Отправка одной команды; итог — продолжать ли очередь. */
function useSendHead(
  deps: QueueDeps & {
    setQueue: (next: Pending[]) => void;
    setOffline: (v: boolean) => void;
    drop: (n: ScoringNotice) => void;
    scheduleRetry: () => void;
  },
) {
  const { matchId, pendingRef, logRef, setConfirmed, setQueue, setOffline, drop, scheduleRetry } = deps;
  return useCallback(
    async (head: Pending): Promise<boolean> => {
      if (!matchId) return false;
      if (head.preview.voidsEventId && isTemp(head.preview.voidsEventId)) {
        drop({ kind: 'rejected', reason: 'event_not_found' });
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
        const event = toScoring(res.data.event);
        if (!logRef.current.some((e) => e.id === event.id)) setConfirmed([...logRef.current, event]);
        setQueue(relink(pendingRef.current.slice(1), head.preview.id, event.id));
        return true;
      } catch (e) {
        if (isTransient(e)) {
          setOffline(true);
          scheduleRetry();
        } else if (e instanceof ApiError && e.code === 'EXPECTED_SEQ_MISMATCH') {
          drop({ kind: 'reset', count: pendingRef.current.length });
        } else
          drop({ kind: 'rejected', reason: e instanceof ApiError ? e.details?.reason : undefined, error: e });
        return false;
      }
    },
    [matchId, pendingRef, logRef, setConfirmed, setQueue, setOffline, drop, scheduleRetry],
  );
}

/** Последовательная отправка очереди с повтором при обрыве связи (пауза растёт до 10 с). */
function useCommandQueue(deps: QueueDeps) {
  const { pendingRef, reload, onChanged } = deps;
  const [pending, setPending] = useState<Pending[]>([]);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<ScoringNotice | null>(null);
  const busy = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(1000);
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);
  const setQueue = useCallback(
    (next: Pending[]) => {
      pendingRef.current = next;
      setPending(next);
    },
    [pendingRef],
  );
  const drop = useCallback(
    (n: ScoringNotice) => {
      setQueue([]);
      setNotice(n);
      reload();
      onChanged();
    },
    [onChanged, reload, setQueue],
  );
  const scheduleRetry = useCallback(() => {
    retry.current = setTimeout(() => void pumpRef.current(), backoff.current);
    backoff.current = Math.min(10_000, backoff.current * 2);
  }, []);
  const sendHead = useSendHead({ ...deps, setQueue, setOffline, drop, scheduleRetry });
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      for (let head = pendingRef.current[0]; head; head = pendingRef.current[0]) {
        if (!(await sendHead(head))) return;
        backoff.current = 1000;
      }
      onChanged();
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [onChanged, pendingRef, sendHead]);
  pumpRef.current = pump;
  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );
  return { pending, setQueue, offline, sending, notice, setNotice, pump };
}

export function useScoring(match: MatchDetailDto | null, rules: ScoringRules | null, onChanged: () => void) {
  const durationMs = (match?.durationSeconds ?? 0) * 1000;
  const pendingRef = useRef<Pending[]>([]);
  const events = useEventLog(match, pendingRef);
  const { logRef } = events;
  const q = useCommandQueue({ matchId: match?.id ?? null, pendingRef, ...events, onChanged });
  const { setQueue, setNotice, pump } = q;
  const all = useMemo(() => [...events.log, ...q.pending.map((p) => p.preview)], [events.log, q.pending]);
  const state: MatchState | null = useMemo(
    () => (rules && match?.state ? replayEvents(all, rules, durationMs) : (match?.state ?? null)),
    [all, rules, durationMs, match?.state],
  );
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
    [logRef, pump, setNotice, setQueue],
  );
  const undo = useCallback(
    (matchClockMs: number) => {
      const plan = planUndo(logRef.current, pendingRef.current);
      if (!plan) return;
      if (plan.drop.length > 0) setQueue(pendingRef.current.filter((p) => !plan.drop.includes(p.preview.id)));
      if (plan.voidId) enqueue({ voidsEventId: plan.voidId, matchClockMs });
    },
    [enqueue, logRef, setQueue],
  );
  return {
    state,
    log: all,
    pendingCount: q.pending.length,
    inFlight: q.sending,
    offline: q.offline,
    notice: q.notice,
    clearNotice: () => setNotice(null),
    enqueue,
    undo,
    /** Что отменит «Отменить последнее». */
    undoTarget: lastVoidableEvent(all),
    /** Последнее подтверждённое событие — expectedSeq для результата. */
    serverSeq: maxSeq(events.log, match?.seq ?? 0),
  };
}
