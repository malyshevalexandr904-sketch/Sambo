// DTO схватки для планшета ковра, подтверждения результатов и экрана «Ковры» (contracts/matches.ts).
import type {
  MatchResultRevisionDto,
  MedicalIncidentDto,
  LocalizedText,
  MatchBriefDto,
  MatchEventDto,
  MatchMatRef,
  MatchResultDto,
  MatchRulesDto,
  MatchSideDto,
  MatchState,
  RuleSetParametersV1,
  Side,
} from '@sde/contracts';
import type { MatchEvent, MatchResultRevision, MedicalIncident, Prisma } from '@sde/db';
import { sideOf, type MatchRecord } from '../../matches';

/** Участие стороны схватки: снимок для отображения (Q-04 — «Фамилия И.»). */
export interface EntryView {
  id: string;
  publicName: string;
  club: string | null;
  region: string | null;
  withdrawn: boolean;
}

export type UserNames = ReadonlyMap<string, string>;

export const EMPTY_TEXT: LocalizedText = { ru: '', en: '' };

export function rulesDto(p: RuleSetParametersV1): MatchRulesDto {
  return {
    actions: p.actions.map((a) => ({
      code: a.code,
      points: a.points ?? null,
      totalVictory: a.kind === 'TOTAL_VICTORY',
    })),
    penalties: p.penalties.map((x) => ({
      code: x.code,
      opponentPoints: x.opponentPoints ?? null,
      disqualification: x.kind === 'DISQUALIFICATION',
    })),
    hold: { thresholds: p.hold.thresholds.map((t) => ({ ...t })), maxPerMatch: p.hold.maxPerMatch },
    superiorityPoints: p.superiorityPoints,
    tieBreakers: [...p.tieBreakers],
  };
}

export function sideDto(m: MatchRecord, side: Side, entries: ReadonlyMap<string, EntryView>): MatchSideDto {
  const p = sideOf(m, side);
  const e = p?.entryId ? entries.get(p.entryId) : undefined;
  return {
    entryId: p?.entryId ?? null,
    bye: p?.isBye ?? false,
    publicName: e?.publicName ?? null,
    club: e?.club ?? null,
    region: e?.region ?? null,
    withdrawn: e?.withdrawn ?? false,
  };
}

const userRef = (id: string | null, names: UserNames) =>
  id ? { id, displayName: names.get(id) ?? '' } : null;

export function resultDto(m: MatchRecord, names: UserNames): MatchResultDto | null {
  const r = m.result;
  if (!r) return null;
  return {
    status: r.status,
    winnerSide: r.winnerSide,
    method: r.method,
    methodDetail: r.methodDetail,
    redScore: r.redScore,
    blueScore: r.blueScore,
    durationMs: r.durationMs,
    basedOnSeq: r.basedOnSeq,
    reason: r.reason,
    system: r.proposedById === null && r.confirmedById === null && r.status !== 'PROVISIONAL',
    proposedBy: userRef(r.proposedById, names),
    proposedAt: r.proposedAt?.toISOString() ?? null,
    confirmedBy: userRef(r.confirmedById, names),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}

/** Пользователи, упомянутые в результатах (кто внёс, кто подтвердил). */
export const resultUserIds = (matches: readonly MatchRecord[]): string[] => [
  ...new Set(
    matches
      .flatMap((m) => [m.result?.proposedById ?? null, m.result?.confirmedById ?? null])
      .filter((x): x is string => x !== null),
  ),
];

/** Проекция счёта, записанная командами судейства (MatchState), или null — схватка не начиналась. */
export function stateOf(value: Prisma.JsonValue | null): MatchState | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as unknown as MatchState)
    : null;
}

export function briefDto(
  m: MatchRecord,
  ctx: {
    categoryName: LocalizedText;
    entries: ReadonlyMap<string, EntryView>;
    names: UserNames;
    mat: MatchMatRef | null;
    plannedAt: Date | null;
  },
): MatchBriefDto {
  const side = (s: Side) => {
    const d = sideDto(m, s, ctx.entries);
    return { publicName: d.publicName, club: d.club, bye: d.bye };
  };
  return {
    id: m.id,
    number: m.matchNumber,
    categoryName: ctx.categoryName,
    roundLabel: m.roundLabel,
    status: m.status,
    red: side('RED'),
    blue: side('BLUE'),
    mat: ctx.mat,
    plannedAt: ctx.plannedAt?.toISOString() ?? null,
    result: resultDto(m, ctx.names),
    version: m.version,
  };
}

export function eventDto(e: MatchEvent, excluded: ReadonlySet<string>, names: UserNames): MatchEventDto {
  const payload = e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? e.payload : null;
  const reason = payload && typeof payload.reason === 'string' ? payload.reason : null;
  return {
    id: e.id,
    seq: e.seq,
    type: e.type,
    side: e.side,
    actionCode: e.actionCode,
    value: e.value,
    matchClockMs: e.matchClockMs,
    deviceTime: e.deviceTime.toISOString(),
    serverTime: e.serverTime.toISOString(),
    voidsEventId: e.voidsEventId,
    deviceId: e.deviceId,
    voided: excluded.has(e.id),
    reason,
    recordedBy: userRef(e.recordedById, names),
  };
}

export function revisionDto(r: MatchResultRevision, names: UserNames): MatchResultRevisionDto {
  return {
    revision: r.revision,
    status: r.status,
    winnerSide: r.winnerSide,
    method: r.method,
    methodDetail: r.methodDetail,
    redScore: r.redScore,
    blueScore: r.blueScore,
    reason: r.reason,
    changedBy: userRef(r.changedById, names),
    changedAt: r.changedAt.toISOString(),
  };
}

/** Запись врача без заметки: заметку видит только медицинский персонал (отдельный запрос, журнал доступа). */
export function incidentDto(
  i: MedicalIncident,
  names: UserNames,
  note: string | null = null,
): MedicalIncidentDto {
  return {
    id: i.id,
    matchId: i.matchId,
    side: i.side,
    entryId: i.entryId,
    kind: i.kind,
    decision: i.decision,
    matchClockMs: i.matchClockMs,
    recordedAt: i.recordedAt.toISOString(),
    recordedBy: userRef(i.recordedById, names),
    note,
  };
}
