// Ход схватки для протокола (макет согласован): события журнала по секундомеру — начало удержания не печатается
// (удержание — одной строкой со временем начала), записи врача на ковре — строкой на своё время со счётом на тот
// момент. Чистая функция: подписи строк — в компоненте протокола.
import type { MatchProtocolDto, ProtocolEventRow } from '@sde/contracts';

type Incident = MatchProtocolDto['incidents'][number];

export type ProtocolLogItem =
  | { kind: 'event'; key: string; time: number; score: string; mark: boolean; event: ProtocolEventRow }
  | { kind: 'incident'; key: string; time: number; score: string; incident: Incident };

export function protocolLog(p: Pick<MatchProtocolDto, 'events' | 'incidents'>): ProtocolLogItem[] {
  const items: ProtocolLogItem[] = [];
  for (const e of p.events) {
    if (e.type === 'HOLD_STARTED') continue;
    items.push({
      kind: 'event',
      key: `e${e.seq}`,
      time: e.type === 'HOLD_ENDED' ? Math.max(0, e.matchClockMs - (e.value ?? 0)) : e.matchClockMs,
      score: `${e.red} : ${e.blue}`,
      mark: e.type === 'CLOCK_STARTED' || e.type === 'CLOCK_STOPPED',
      event: e,
    });
  }
  for (const i of p.incidents) {
    const at = i.matchClockMs ?? 0;
    const idx = items.findIndex((r) => r.time > at);
    const before = idx === -1 ? items : items.slice(0, idx);
    const item: ProtocolLogItem = {
      kind: 'incident',
      key: `m${i.id}`,
      time: at,
      score: before.length > 0 ? before[before.length - 1]!.score : '0 : 0',
      incident: i,
    };
    if (idx === -1) items.push(item);
    else items.splice(idx, 0, item);
  }
  return items;
}
