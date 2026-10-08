// Печатные протоколы (план Phase 7b, §5; макеты согласованы заказчиком 2026-10-08): протокол схватки и протокол
// категории — данные для печати из браузера (A4). Служебные документы: полные ФИО и год рождения, право
// `export.create`, каждое чтение — в журнал доступа.
import { Injectable } from '@nestjs/common';
import {
  type CategoryProtocolDto,
  type CategoryProtocolMatchRow,
  excludedEventIds,
  fullName,
  holdPoints,
  type LocalizedText,
  type MatchProtocolDto,
  type ProtocolEventRow,
  type ProtocolHeader,
  type ProtocolParticipant,
  replayEvents,
  type RuleSetParametersV1,
  type ScoringEvent,
} from '@sde/contracts';
import type { MatchEvent } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { DataAccessLogService } from '../../audit';
import { CategoryWorkflowService } from '../../categories';
import { MATCH_INCLUDE, type MatchRecord, MatchStoreService, sideOf } from '../../matches';
import { MatchContextService, toScoringEvents } from './match-context.service';
import { incidentDto, resultDto, revisionDto } from './match-mapper';

interface PersonName {
  lastName: string;
  firstName: string;
  middleName: string | null;
}

/** «Ковров И. П.» — подпись в протоколе; без человека — отображаемое имя пользователя. */
const signatureName = (u: { displayName: string; person: PersonName | null } | null): string | null => {
  if (!u) return null;
  if (!u.person) return u.displayName;
  const initials = [u.person.firstName, u.person.middleName]
    .filter((x): x is string => !!x)
    .map((x) => `${x[0]}.`)
    .join(' ');
  return `${u.person.lastName} ${initials}`.trim();
};

const USER_SELECT = {
  displayName: true,
  person: { select: { lastName: true, firstName: true, middleName: true } },
} as const;

/** Баллы события по правилам: кому и сколько (наказание — сопернику по порядку наказаний). */
function eventPoints(
  e: ScoringEvent,
  rules: RuleSetParametersV1,
  penaltyIndex: Map<string, number>,
): { points: number | null; to: 'RED' | 'BLUE' | null } {
  if (!e.side) return { points: null, to: null };
  const opponent = e.side === 'RED' ? 'BLUE' : 'RED';
  if (e.type === 'SCORE') {
    const action = rules.actions.find((a) => a.code === e.actionCode);
    return { points: action && action.kind !== 'TOTAL_VICTORY' ? (action.points ?? 0) : null, to: e.side };
  }
  if (e.type === 'HOLD_ENDED') return { points: holdPoints(rules, e.value ?? 0) || null, to: e.side };
  if (e.type === 'PENALTY') {
    const n = penaltyIndex.get(e.id) ?? 0;
    const p = rules.penalties[n];
    return {
      points: p && p.kind !== 'DISQUALIFICATION' ? (p.opponentPoints ?? 0) || null : null,
      to: opponent,
    };
  }
  return { points: null, to: null };
}

@Injectable()
export class ProtocolsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly context: MatchContextService,
    private readonly store: MatchStoreService,
    private readonly categories: CategoryWorkflowService,
    private readonly accessLog: DataAccessLogService,
  ) {}

  private async header(competitionId: string): Promise<ProtocolHeader> {
    const c = await this.db.competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        timezone: true,
        organizer: { select: { name: true } },
        discipline: { select: { nameRu: true, nameEn: true } },
      },
    });
    return {
      competitionId: c.id,
      competitionName: c.name,
      organizerName: c.organizer.name,
      disciplineName: { ru: c.discipline.nameRu, en: c.discipline.nameEn },
      startDate: c.startDate.toISOString().slice(0, 10),
      endDate: c.endDate.toISOString().slice(0, 10),
      timezone: c.timezone,
      generatedAt: new Date().toISOString(),
    };
  }

  private async participants(entryIds: readonly string[]): Promise<Map<string, ProtocolParticipant>> {
    if (entryIds.length === 0) return new Map();
    const rows = await this.db.entry.findMany({
      where: { id: { in: [...entryIds] } },
      select: {
        id: true,
        publicName: true,
        snapLastName: true,
        snapFirstName: true,
        snapMiddleName: true,
        snapBirthDate: true,
        snapClubName: true,
        snapRegionName: true,
        snapRankCode: true,
      },
    });
    const rankCodes = [...new Set(rows.map((r) => r.snapRankCode).filter((x): x is string => !!x))];
    const ranks = rankCodes.length
      ? await this.db.sportRank.findMany({ where: { code: { in: rankCodes } } })
      : [];
    const rankName = new Map<string, LocalizedText>(
      ranks.map((r) => [r.code, { ru: r.nameRu, en: r.nameEn }]),
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          entryId: r.id,
          fullName: fullName({
            lastName: r.snapLastName,
            firstName: r.snapFirstName,
            middleName: r.snapMiddleName,
          }),
          publicName: r.publicName,
          birthYear: r.snapBirthDate.getUTCFullYear(),
          rank: r.snapRankCode ? (rankName.get(r.snapRankCode) ?? null) : null,
          club: r.snapClubName,
          region: r.snapRegionName,
        },
      ]),
    );
  }

  private async assertExport(user: AuthUser, competitionId: string): Promise<void> {
    await this.policy.assert(user, 'export.create', await this.context.scopeOf(competitionId));
  }

  /** Журнал схватки для протокола: время, действие, баллы, счёт после события; отменённые — с причиной. */
  private eventRows(
    rows: readonly MatchEvent[],
    rules: RuleSetParametersV1,
    durationMs: number,
  ): ProtocolEventRow[] {
    const log = toScoringEvents(rows);
    const excluded = excludedEventIds(log);
    const voids = new Map(
      rows
        .filter((r) => r.type === 'EVENT_VOIDED' && r.voidsEventId)
        .map((r) => {
          const payload =
            r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? r.payload : null;
          const reason = payload && typeof payload.reason === 'string' ? payload.reason : null;
          return [r.voidsEventId as string, { at: r.matchClockMs, reason }];
        }),
    );
    // Наказания идут по порядку правил среди засчитанных: номер наказания стороны.
    const penaltyIndex = new Map<string, number>();
    const counters = { RED: 0, BLUE: 0 };
    const kept: ScoringEvent[] = [];
    const out: ProtocolEventRow[] = [];
    let score = { red: 0, blue: 0 };
    for (const e of log) {
      if (e.type === 'EVENT_VOIDED') continue;
      const voided = excluded.has(e.id);
      if (!voided) {
        if (e.type === 'PENALTY' && e.side) penaltyIndex.set(e.id, counters[e.side]++);
        kept.push(e);
        const s = replayEvents(kept, rules, durationMs);
        score = { red: s.red.points, blue: s.blue.points };
      }
      const pts = voided ? { points: null, to: null } : eventPoints(e, rules, penaltyIndex);
      const v = voids.get(e.id) ?? null;
      out.push({
        seq: e.seq,
        matchClockMs: e.matchClockMs,
        type: e.type,
        side: e.side,
        actionCode: e.actionCode,
        value: e.value,
        points: pts.points,
        pointsTo: pts.to,
        red: score.red,
        blue: score.blue,
        voided,
        voidReason: v?.reason ?? null,
        voidedAtMs: v?.at ?? null,
      });
    }
    return out;
  }

  async match(user: AuthUser, matchId: string): Promise<MatchProtocolDto> {
    const m = await this.db.match.findUnique({ where: { id: matchId }, include: MATCH_INCLUDE });
    if (!m) throw new DomainError('NOT_FOUND', { resource: 'match' });
    await this.assertExport(user, m.competitionId);
    const [header, rules, events, revisions, incidents, slot, category] = await Promise.all([
      this.header(m.competitionId),
      this.context.rules(this.db, m.competitionId),
      this.store.events(null, matchId),
      this.store.revisions(null, [matchId]),
      this.store.incidents(null, [matchId]),
      this.db.matchSchedule.findUnique({ where: { matchId }, select: { sessionId: true, matId: true } }),
      this.db.competitionCategory.findUniqueOrThrow({
        where: { id: m.categoryId },
        select: { nameRu: true, nameEn: true },
      }),
    ]);
    const red = sideOf(m, 'RED')?.entryId ?? null;
    const blue = sideOf(m, 'BLUE')?.entryId ?? null;
    const people = await this.participants([red, blue].filter((x): x is string => !!x));
    const matId = m.matId ?? slot?.matId ?? null;
    const mat = matId
      ? await this.db.mat.findUnique({ where: { id: matId }, select: { number: true, name: true } })
      : null;
    const names = await this.userNames([
      ...[m.result?.proposedById, m.result?.confirmedById].filter((x): x is string => !!x),
      ...revisions.map((r) => r.changedById),
      ...incidents.map((i) => i.recordedById),
    ]);
    const durationMs = (m.durationSeconds ?? 0) * 1000;
    const rows = this.eventRows(events, rules, durationMs);
    const final = replayEvents(toScoringEvents(events), rules, durationMs);
    const result = resultDto(m, names);
    await this.accessLog.record('VIEW', 'MatchProtocol', matchId, m.competitionId);
    return {
      header,
      matchId: m.id,
      publicId: m.publicId,
      number: m.matchNumber,
      categoryName: { ru: category.nameRu, en: category.nameEn },
      roundLabel: m.roundLabel,
      manual: m.bracketNodeId === null,
      mat,
      durationSeconds: m.durationSeconds,
      startedAt: m.startedAt?.toISOString() ?? null,
      finishedAt: m.finishedAt?.toISOString() ?? null,
      red: red ? (people.get(red) ?? null) : null,
      blue: blue ? (people.get(blue) ?? null) : null,
      events: rows,
      penalties: { red: final.red.penalties, blue: final.blue.penalties },
      result: result ? { ...result } : null,
      revisions: revisions.map((r) => revisionDto(r, names)),
      incidents: incidents.map((i) => {
        const { note: _note, ...rest } = incidentDto(i, names);
        return rest;
      }),
      signatures: await this.crewSignatures(m, slot?.sessionId ?? null, matId, names),
    };
  }

  private async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    const users = ids.length
      ? await this.db.user.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: { id: true, ...USER_SELECT },
        })
      : [];
    return new Map(users.map((u) => [u.id, signatureName(u) ?? u.displayName]));
  }

  /** Подписи протокола схватки: бригада ковра в сессии схватки; без бригады — кто внёс и кто подтвердил. */
  private async crewSignatures(
    m: MatchRecord,
    sessionId: string | null,
    matId: string | null,
    names: ReadonlyMap<string, string>,
  ): Promise<MatchProtocolDto['signatures']> {
    const crew =
      sessionId && matId
        ? await this.db.matAssignment.findMany({
            where: { sessionId, matId, role: { in: ['REFEREE', 'MAT_CHIEF'] } },
            select: { role: true, user: { select: USER_SELECT } },
          })
        : [];
    const byRole = (role: string) => signatureName(crew.find((c) => c.role === role)?.user ?? null);
    const named = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);
    return {
      referee: byRole('REFEREE') ?? named(m.result?.proposedById),
      matChief: byRole('MAT_CHIEF') ?? named(m.result?.confirmedById),
    };
  }

  /** Подписи протокола категории: главный судья и главный секретарь (первые по назначению в турнир). */
  private async staffSignatures(competitionId: string): Promise<CategoryProtocolDto['signatures']> {
    const staff = await this.db.competitionMembership.findMany({
      where: { competitionId, status: 'ACTIVE', role: { code: { in: ['CHIEF_REFEREE', 'SECRETARY'] } } },
      orderBy: { createdAt: 'asc' },
      select: { role: { select: { code: true } }, user: { select: USER_SELECT } },
    });
    const byRole = (code: string) => signatureName(staff.find((s) => s.role.code === code)?.user ?? null);
    return { chiefReferee: byRole('CHIEF_REFEREE'), chiefSecretary: byRole('SECRETARY') };
  }

  async category(user: AuthUser, categoryId: string): Promise<CategoryProtocolDto> {
    const category = await this.categories.require(categoryId);
    await this.assertExport(user, category.competitionId);
    const [header, draw, result, matches, signatures] = await Promise.all([
      this.header(category.competitionId),
      this.db.draw.findFirst({
        where: { categoryId, status: 'PUBLISHED' },
        select: { format: true, slots: { select: { entryId: true } } },
      }),
      this.db.categoryResult.findUnique({
        where: { categoryId },
        include: { placements: { orderBy: [{ place: 'asc' }, { entryId: 'asc' }] } },
      }),
      this.db.match.findMany({
        where: { categoryId },
        include: MATCH_INCLUDE,
        orderBy: [{ matchNumber: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
      this.staffSignatures(category.competitionId),
    ]);
    const entryIds = [
      ...new Set([
        ...(result?.placements ?? []).map((p) => p.entryId),
        ...matches.flatMap((m) => m.participants.map((p) => p.entryId)).filter((x): x is string => !!x),
      ]),
    ];
    const people = await this.participants(entryIds);
    const revisions = await this.store.revisions(
      null,
      matches.filter((m) => (m.result?.revision ?? 1) > 1).map((m) => m.id),
    );
    const names = await this.userNames(revisions.map((r) => r.changedById));
    const lastRevision = new Map<string, (typeof revisions)[number]>();
    for (const r of revisions) lastRevision.set(r.matchId, r);
    await this.accessLog.record('VIEW', 'CategoryProtocol', categoryId, category.competitionId);
    return {
      header,
      categoryId,
      categoryCode: category.code,
      categoryName: { ru: category.nameRu, en: category.nameEn },
      format: draw?.format ?? null,
      participants: draw ? draw.slots.filter((s) => s.entryId !== null).length : entryIds.length,
      resultStatus: result?.status ?? null,
      publishedAt: result?.publishedAt?.toISOString() ?? null,
      places: (result?.placements ?? [])
        .map((p) => {
          const person = people.get(p.entryId);
          return person
            ? { ...person, place: p.place, medal: p.medal, wins: p.wins, losses: p.losses }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      matches: matches.map((m) => this.matchRow(m, people, lastRevision.get(m.id) ?? null, names)),
      signatures,
    };
  }

  private matchRow(
    m: MatchRecord,
    people: ReadonlyMap<string, ProtocolParticipant>,
    revision: Parameters<typeof revisionDto>[0] | null,
    names: ReadonlyMap<string, string>,
  ): CategoryProtocolMatchRow {
    const side = (s: 'RED' | 'BLUE') => sideOf(m, s);
    const name = (s: 'RED' | 'BLUE'): string | null => {
      const id = side(s)?.entryId;
      return id ? (people.get(id)?.publicName ?? null) : null;
    };
    const r = m.result;
    const noMatch =
      m.status === 'CANCELLED' || (m.status === 'FINISHED' && m.participants.some((p) => p.entryId === null));
    return {
      matchId: m.id,
      number: m.matchNumber,
      roundLabel: m.roundLabel,
      red: name('RED'),
      blue: name('BLUE'),
      redBye: side('RED')?.isBye ?? false,
      blueBye: side('BLUE')?.isBye ?? false,
      winnerSide: r?.status === 'PROVISIONAL' ? null : (r?.winnerSide ?? null),
      method: r?.status === 'PROVISIONAL' ? null : (r?.method ?? null),
      methodDetail: r?.status === 'PROVISIONAL' ? null : (r?.methodDetail ?? null),
      redScore: r?.redScore ?? null,
      blueScore: r?.blueScore ?? null,
      noMatch,
      amended:
        r && revision
          ? {
              at: r.confirmedAt?.toISOString() ?? revision.changedAt.toISOString(),
              previous: revisionDto(revision, names),
              reason: revision.reason,
            }
          : null,
    };
  }
}
