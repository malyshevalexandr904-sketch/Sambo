// Время турнира (ADR-13; ARCHITECTURE.md, 19). Моменты хранятся в UTC, у турнира — IANA timezone.
// Чистые функции на Intl: одинаково работают на сервере и в браузере.

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function partsIn(ms: number, timeZone: string): Parts {
  const values: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') values[p.type] = Number(p.value);
  }
  return {
    y: values.year ?? 0,
    m: values.month ?? 1,
    d: values.day ?? 1,
    h: values.hour ?? 0,
    mi: values.minute ?? 0,
    s: values.second ?? 0,
  };
}

/** Смещение часового пояса в момент `ms`, миллисекунды (Москва — +3 ч). */
function offsetMs(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Календарная дата момента в часовом поясе: «2026-11-01T20:59:59Z» в Europe/Moscow → «2026-11-01». */
export function localDateIn(instant: string | Date, timeZone: string): string {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const p = partsIn(ms, timeZone);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

/** Местное время момента для полей ввода: «YYYY-MM-DDTHH:mm». */
export function localDateTimeIn(instant: string | Date, timeZone: string): string {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const p = partsIn(ms, timeZone);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/**
 * Момент UTC для местного времени в часовом поясе: «2026-11-01T23:59» в Europe/Moscow → «2026-11-01T20:59:00.000Z».
 * При переходе на летнее время несуществующее время сдвигается вперёд, неоднозначное — берётся первое.
 */
export function zonedToInstant(localDateTime: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) throw new Error(`Invalid local date-time: ${localDateTime}`);
  const [, y, m, d, h, mi, s] = match;
  const asUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  let result = asUtc - offsetMs(asUtc, timeZone);
  const corrected = asUtc - offsetMs(result, timeZone);
  if (corrected !== result) result = Math.min(result, corrected);
  return new Date(result).toISOString();
}

/** Сегодняшняя дата в часовом поясе турнира. */
export const todayIn = (timeZone: string, now: Date = new Date()): string => localDateIn(now, timeZone);
