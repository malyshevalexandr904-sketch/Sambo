// Время журнала схватки — к часам сервера (Phase 8a, табло): секундомер ведёт планшет (R-09), события несут время
// устройства. Табло — другое устройство: счёт по журналу пересчитывается с моментами по часам сервера, иначе
// расхождение часов планшета и табло сдвинет таймер. Сдвиг устройства — наименьшая разница «время приёма сервером −
// время устройства» среди его событий (событие, отправленное без задержки очереди); у события без устройства — его
// собственная разница.
import type { ScoringEvent } from '@sde/contracts';

export interface TimedEvent extends ScoringEvent {
  deviceId: string | null;
  serverTime: string;
}

export function toServerClock(events: readonly TimedEvent[]): ScoringEvent[] {
  const offset = new Map<string, number>();
  for (const e of events) {
    if (!e.deviceId) continue;
    const d = Date.parse(e.serverTime) - Date.parse(e.deviceTime);
    offset.set(e.deviceId, Math.min(offset.get(e.deviceId) ?? Infinity, d));
  }
  return events.map(({ deviceId, serverTime, ...e }) => {
    const shift = deviceId ? (offset.get(deviceId) ?? 0) : Date.parse(serverTime) - Date.parse(e.deviceTime);
    return { ...e, deviceTime: new Date(Date.parse(e.deviceTime) + shift).toISOString() };
  });
}
