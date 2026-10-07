// Чистые функции очереди команд планшета ковра (план Phase 7a, §2, §5): запрос команды, «Отменить последнее»,
// перевод отмены с временного номера на серверный, что повторять при обрыве связи, сведение времени чужого
// устройства к часам этого планшета, сохранение очереди на время перезагрузки страницы.
import { excludedEventIds, lastVoidableEvent, type MatchEventDto, type ScoringEvent } from '@sde/contracts';
import { ApiError } from '@/lib/api';

export type EventInput = Pick<ScoringEvent, 'type' | 'side' | 'actionCode' | 'value' | 'matchClockMs'>;

export interface Pending {
  key: string;
  preview: ScoringEvent;
  /** Номер последнего события, на котором основана команда; задаётся при первой отправке и не меняется. */
  sentSeq: number | null;
}

/** Событие журнала с сервера: событие счёта, устройство и время приёма сервером. */
export interface LogEvent extends ScoringEvent {
  deviceId: string | null;
  serverTime: string | null;
}

export const TEMP = 'local:';
export const isTemp = (id: string): boolean => id.startsWith(TEMP);
export const maxSeq = (events: readonly ScoringEvent[], floor = 0): number =>
  events.reduce((m, e) => Math.max(m, e.seq), floor);

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

/** Хранилище вкладки: переживает перезагрузку страницы; недоступно (приватный режим) — работаем без него. */
function tabStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Устройство — вкладка планшета: одно и то же после перезагрузки страницы (журнал: кто и с какого устройства). */
export const DEVICE_ID: string = (() => {
  const store = tabStorage();
  try {
    const known = store?.getItem('sde.tablet.device');
    if (known) return known;
    const id = `tablet-${uuid().slice(0, 8)}`;
    store?.setItem('sde.tablet.device', id);
    return id;
  } catch {
    return typeof window === 'undefined' ? 'server' : `tablet-${uuid().slice(0, 8)}`;
  }
})();

const queueKey = (matchId: string): string => `sde.tablet.queue.${matchId}`;

/** Неотправленные команды схватки, сохранённые до перезагрузки страницы (ключи те же — сервер не создаст дубль). */
export function loadQueue(matchId: string): Pending[] {
  try {
    const raw = tabStorage()?.getItem(queueKey(matchId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Pending[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(matchId: string, queue: readonly Pending[]): void {
  try {
    const store = tabStorage();
    if (queue.length === 0) store?.removeItem(queueKey(matchId));
    else store?.setItem(queueKey(matchId), JSON.stringify(queue));
  } catch {
    // Хранилище переполнено или недоступно: очередь остаётся в памяти вкладки.
  }
}

/** Событие журнала с сервера → событие счёта (общий редьюсер packages/contracts) с устройством и временем приёма. */
export function fromServer(e: MatchEventDto): LogEvent {
  return {
    id: e.id,
    seq: e.seq,
    type: e.type,
    side: e.side,
    actionCode: e.actionCode,
    value: e.value,
    matchClockMs: e.matchClockMs,
    deviceTime: e.deviceTime,
    voidsEventId: e.voidsEventId,
    deviceId: e.deviceId,
    serverTime: e.serverTime,
  };
}

/** Журнал схватки: события по номеру, без повторов (события неизменны — слияние по id безопасно). */
export function mergeLog(base: readonly LogEvent[], incoming: readonly LogEvent[]): LogEvent[] {
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Время событий чужих устройств — к часам этого планшета. Часы планшетов расходятся: секундомер, запущенный на
 * другом планшете, считается от его `deviceTime`. Сдвиг устройства относительно сервера — наименьшая разница
 * «время приёма сервером − время устройства» по его событиям (событие, отправленное без задержки); сдвиг этого
 * планшета — по времени сервера в ответе (`serverOffsetMs` = сервер − планшет). Свои события не меняются.
 */
export function localizeTimes(
  events: readonly LogEvent[],
  myDevice: string,
  serverOffsetMs: number,
): ScoringEvent[] {
  const deviceOffset = new Map<string, number>();
  for (const e of events) {
    if (!e.deviceId || e.deviceId === myDevice || !e.serverTime) continue;
    const d = Date.parse(e.serverTime) - Date.parse(e.deviceTime);
    deviceOffset.set(e.deviceId, Math.min(deviceOffset.get(e.deviceId) ?? Infinity, d));
  }
  return events.map((e) => {
    const offset = e.deviceId ? deviceOffset.get(e.deviceId) : undefined;
    if (offset === undefined) return e;
    return { ...e, deviceTime: new Date(Date.parse(e.deviceTime) + offset - serverOffsetMs).toISOString() };
  });
}

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
