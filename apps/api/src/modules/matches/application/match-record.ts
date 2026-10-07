// Схватка как запись БД: стороны и результат (DATABASE.md, 3.6). Общие определения сервисов модуля matches.
import { CONFIRMED_RESULT_STATUSES, type MatchStatus, type Side } from '@sde/contracts';
import type { Prisma } from '@sde/db';

export const MATCH_INCLUDE = { participants: true, result: true } satisfies Prisma.MatchInclude;
export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof MATCH_INCLUDE }>;

/** Схватка началась: её стороны больше не меняются продвижением по сетке. */
const STARTED: readonly MatchStatus[] = ['IN_PROGRESS', 'PAUSED'];

export const sideOf = (m: Pick<MatchRecord, 'participants'>, side: Side) =>
  m.participants.find((p) => p.side === side);

/** Сыграна (а не завершена системой без соперника): оба участника известны, схватка завершена. */
export const isPlayed = (m: Pick<MatchRecord, 'status' | 'participants'>): boolean =>
  m.status === 'FINISHED' && m.participants.length === 2 && m.participants.every((p) => p.entryId !== null);

export const isStartedOrPlayed = (m: MatchRecord): boolean => STARTED.includes(m.status) || isPlayed(m);

/** Результат подтверждён (продвигает сетку): подтверждён, опубликован или изменён после подтверждения. */
export const isConfirmed = (m: Pick<MatchRecord, 'result'>): boolean =>
  !!m.result && CONFIRMED_RESULT_STATUSES.includes(m.result.status);

/** Участник схватки по стороне или null. */
export const entryOn = (m: Pick<MatchRecord, 'participants'>, side: Side): string | null =>
  sideOf(m, side)?.entryId ?? null;
