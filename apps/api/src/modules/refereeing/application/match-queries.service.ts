// Чтение судейства (API.md, 6.3; план Phase 7a, §5, §7): схватка с состоянием и доступными действиями, журнал,
// планшет ковра, раздел «Судейство» и схватки, ждущие подтверждения. Право — competition.view (весь персонал);
// действия — по правам, назначению на ковёр (MAT_ASSIGNED, MAT_CHIEF) и состоянию схватки.
import { Injectable } from '@nestjs/common';
import {
  determineOutcome,
  excludedEventIds,
  type LocalizedText,
  type MatchAction,
  type MatchDetailDto,
  type MatchEventsDto,
  type MatchMatRef,
  type MatConsoleDto,
  type MatCrewRole,
  type OfficiatingDto,
  type OfficiatingMatDto,
  type PendingConfirmationDto,
  type PermissionCode,
} from '@sde/contracts';
import type { Session, Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { CompetitionScopeService } from '../../competitions';
import { entryOn, MATCH_INCLUDE, type MatchRecord, MatchStoreService } from '../../matches';
import { CrewAccessService } from '../../scheduling';
import { isLive, noShowAllowed } from '../domain/match-machine';
import { MatchContextService, toScoringEvents } from './match-context.service';
import {
  briefDto,
  EMPTY_TEXT,
  type EntryView,
  eventDto,
  resultDto,
  resultUserIds,
  rulesDto,
  sideDto,
  stateOf,
} from './match-mapper';

const CANDIDATES: readonly PermissionCode[] = [
  'match.update',
  'match.start',
  'match.finish',
  'scoring.create',
  'scoring.update',
  'result.confirm',
];

const UPCOMING = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'PAUSED'] as const;

interface Slot {
  sessionId: string;
  matId: string;
  plannedAt: Date;
}

interface ViewContext {
  categories: Map<string, LocalizedText>;
  entries: Map<string, EntryView>;
  names: Map<string, string>;
  slots: Map<string, Slot>;
  mats: Map<string, MatchMatRef>;
}

/** Решена без игры: без соперника (BYE) или пустая — в очереди ковра не показывается. */
const isNoMatch = (m: MatchRecord): boolean =>
  m.status === 'CANCELLED' || (m.status === 'FINISHED' && m.participants.some((p) => p.entryId === null));

/** Текущая схватка ковра: идёт или на паузе, иначе вызванная, иначе первая в плановом порядке. */
/**
 * Текущая схватка ковра: идёт или на паузе, иначе вызванная, иначе первая по плану с известной парой (схватка,
 * ждущая победителя с другого ковра, не держит ковёр), иначе первая по плану.
 */
function currentOf<T extends MatchRecord>(queue: readonly T[]): T | null {
  return (
    queue.find((m) => m.status === 'IN_PROGRESS' || m.status === 'PAUSED') ??
    queue.find((m) => m.status === 'READY') ??
    queue.find((m) => entryOn(m, 'RED') !== null && entryOn(m, 'BLUE') !== null) ??
    queue[0] ??
    null
  );
}

@Injectable()
export class MatchQueriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly context: MatchContextService,
    private readonly store: MatchStoreService,
    private readonly crews: CrewAccessService,
  ) {}

  private async loadContext(db: Tx, matches: readonly MatchRecord[]): Promise<ViewContext> {
    const ids = matches.map((m) => m.id);
    const entryIds = [
      ...new Set(
        matches.flatMap((m) => m.participants.map((p) => p.entryId)).filter((x): x is string => !!x),
      ),
    ];
    const [categories, entries, users, slots] = await Promise.all([
      db.competitionCategory.findMany({
        where: { id: { in: [...new Set(matches.map((m) => m.categoryId))] } },
        select: { id: true, nameRu: true, nameEn: true },
      }),
      entryIds.length
        ? db.entry.findMany({
            where: { id: { in: entryIds } },
            select: { id: true, publicName: true, snapClubName: true, snapRegionName: true, status: true },
          })
        : Promise.resolve([]),
      db.user.findMany({
        where: { id: { in: resultUserIds(matches) } },
        select: { id: true, displayName: true },
      }),
      db.matchSchedule.findMany({
        where: { matchId: { in: ids } },
        select: { matchId: true, sessionId: true, matId: true, plannedAt: true },
      }),
    ]);
    const matIds = [
      ...new Set(
        [...slots.map((s) => s.matId), ...matches.map((m) => m.matId)].filter((x): x is string => !!x),
      ),
    ];
    const mats = matIds.length
      ? await db.mat.findMany({
          where: { id: { in: matIds } },
          select: { id: true, number: true, name: true },
        })
      : [];
    return {
      categories: new Map(categories.map((c) => [c.id, { ru: c.nameRu, en: c.nameEn }])),
      entries: new Map(
        entries.map((e) => [
          e.id,
          {
            id: e.id,
            publicName: e.publicName,
            club: e.snapClubName,
            region: e.snapRegionName,
            withdrawn: e.status === 'WITHDRAWN',
          },
        ]),
      ),
      names: new Map(users.map((u) => [u.id, u.displayName])),
      slots: new Map(slots.map((s) => [s.matchId, s])),
      mats: new Map(mats.map((m) => [m.id, m])),
    };
  }

  private matOf(m: MatchRecord, ctx: ViewContext): MatchMatRef | null {
    const id = m.matId ?? ctx.slots.get(m.id)?.matId ?? null;
    return id ? (ctx.mats.get(id) ?? null) : null;
  }

  private brief(m: MatchRecord, ctx: ViewContext) {
    return briefDto(m, {
      categoryName: ctx.categories.get(m.categoryId) ?? EMPTY_TEXT,
      entries: ctx.entries,
      names: ctx.names,
      mat: this.matOf(m, ctx),
      plannedAt: ctx.slots.get(m.id)?.plannedAt ?? null,
    });
  }

  /** Действия над схваткой, доступные пользователю сейчас (права с политиками бригады × состояние). */
  async actions(user: AuthUser, scope: ResourceScope, m: MatchRecord): Promise<MatchAction[]> {
    const perms = new Set(await this.policy.allowedActionsAny(user, [scope], CANDIDATES, { matchId: m.id }));
    const both = entryOn(m, 'RED') !== null && entryOn(m, 'BLUE') !== null;
    const provisional = m.status === 'FINISHED' && m.result?.status === 'PROVISIONAL';
    const a: MatchAction[] = [];
    const add = (ok: boolean, action: MatchAction): void => {
      if (ok) a.push(action);
    };
    add(m.status === 'SCHEDULED' && both && perms.has('match.update'), 'transition:READY');
    add(m.status === 'READY' && perms.has('match.update'), 'transition:SCHEDULED');
    add(
      (m.status === 'READY' || m.status === 'PAUSED') && perms.has('match.start'),
      'transition:IN_PROGRESS',
    );
    add(m.status === 'IN_PROGRESS' && perms.has('match.update'), 'transition:PAUSED');
    add(m.status === 'IN_PROGRESS' && perms.has('scoring.create'), 'event.create');
    add(m.status === 'IN_PROGRESS' && perms.has('scoring.update'), 'event.void');
    add((isLive(m.status) || provisional) && perms.has('match.finish'), 'result.record');
    add(provisional && perms.has('result.confirm'), 'result.confirm');
    add(noShowAllowed(m.status) && both && perms.has('match.finish'), 'no_show');
    return a;
  }

  private async detailOf(user: AuthUser, scope: ResourceScope, m: MatchRecord, ctx: ViewContext) {
    const rules = await this.context.rules(this.db, m.competitionId);
    const state = stateOf(m.state);
    const slot = ctx.slots.get(m.id) ?? null;
    const dto: MatchDetailDto = {
      id: m.id,
      publicId: m.publicId,
      competitionId: m.competitionId,
      categoryId: m.categoryId,
      categoryName: ctx.categories.get(m.categoryId) ?? EMPTY_TEXT,
      number: m.matchNumber,
      roundLabel: m.roundLabel,
      status: m.status,
      durationSeconds: m.durationSeconds,
      mat: this.matOf(m, ctx),
      sessionId: slot?.sessionId ?? null,
      plannedAt: slot?.plannedAt.toISOString() ?? null,
      readyAt: m.readyAt?.toISOString() ?? null,
      startedAt: m.startedAt?.toISOString() ?? null,
      finishedAt: m.finishedAt?.toISOString() ?? null,
      red: sideDto(m, 'RED', ctx.entries),
      blue: sideDto(m, 'BLUE', ctx.entries),
      state,
      seq: m.stateSeq,
      result: resultDto(m, ctx.names),
      proposedOutcome: state ? determineOutcome(state, rules) : null,
      rules: rulesDto(rules),
      version: m.version,
      allowedActions: await this.actions(user, scope, m),
    };
    return dto;
  }

  async detail(user: AuthUser, matchId: string): Promise<MatchDetailDto> {
    const m = await this.db.match.findUnique({ where: { id: matchId }, include: MATCH_INCLUDE });
    if (!m) throw new DomainError('NOT_FOUND', { resource: 'match' });
    const scope = await this.context.scopeOf(m.competitionId);
    await this.policy.assert(user, 'competition.view', scope);
    return this.detailOf(user, scope, m, await this.loadContext(this.db, [m]));
  }

  async events(user: AuthUser, matchId: string, afterSeq: number): Promise<MatchEventsDto> {
    const head = await this.context.head(matchId);
    await this.policy.assert(user, 'competition.view', await this.context.scopeOf(head.competitionId));
    const all = await this.store.events(null, matchId);
    const excluded = excludedEventIds(toScoringEvents(all));
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(all.map((e) => e.recordedById).filter((x): x is string => !!x))] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      matchId,
      seq: all.length ? (all[all.length - 1]?.seq ?? 0) : 0,
      events: all.filter((e) => e.seq > afterSeq).map((e) => eventDto(e, excluded, names)),
    };
  }

  private async pendingOf(
    user: AuthUser,
    scope: ResourceScope,
    matches: readonly MatchRecord[],
    ctx: ViewContext,
  ): Promise<PendingConfirmationDto[]> {
    const result: PendingConfirmationDto[] = [];
    for (const m of matches)
      result.push({
        ...this.brief(m, ctx),
        canConfirm: await this.policy.can(user, 'result.confirm', scope, { matchId: m.id }),
      });
    return result;
  }

  /** Схватки турнира, ждущие подтверждения результата: главный судья подтверждает любые, руководитель — своего ковра. */
  async pending(user: AuthUser, competitionId: string): Promise<PendingConfirmationDto[]> {
    const scope = await this.competitions.scopeOf(competitionId);
    await this.policy.assert(user, 'competition.view', scope);
    const matches = await this.db.match.findMany({
      where: { competitionId, status: 'FINISHED', result: { status: 'PROVISIONAL' } },
      include: MATCH_INCLUDE,
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
    });
    return this.pendingOf(user, scope, matches, await this.loadContext(this.db, matches));
  }

  private async slotsOfMat(matId: string): Promise<MatchRecord[]> {
    const rows = await this.db.matchSchedule.findMany({
      where: {
        matId,
        OR: [
          { match: { status: { in: [...UPCOMING] } } },
          { match: { status: 'FINISHED', result: { status: 'PROVISIONAL' } } },
        ],
      },
      include: { match: { include: MATCH_INCLUDE } },
      orderBy: [{ plannedAt: 'asc' }, { orderInMat: 'asc' }],
    });
    return rows.map((r) => r.match).filter((m) => !isNoMatch(m));
  }

  private competitionRef(c: {
    id: string;
    name: string;
    timezone: string;
    status: OfficiatingDto['competition']['status'];
  }) {
    return { id: c.id, name: c.name, timezone: c.timezone, status: c.status };
  }

  private sessionRef(s: Session | null) {
    return s
      ? { id: s.id, name: s.name, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }
      : null;
  }

  /** Планшет ковра: текущая схватка целиком, следующая, ждущие подтверждения; мои должности в текущей сессии. */
  async console(user: AuthUser, matId: string): Promise<MatConsoleDto> {
    const mat = await this.db.mat.findUnique({ where: { id: matId } });
    if (!mat) throw new DomainError('NOT_FOUND', { resource: 'mat' });
    const competition = await this.competitions.require(mat.competitionId);
    const scope = await this.competitions.scopeFor(competition);
    await this.policy.assert(user, 'competition.view', scope);
    const session = await this.crews.currentSession(competition.id);
    const myRoles: MatCrewRole[] = session
      ? ((await this.crews.rolesInSession(user.id, session.id)).get(matId) ?? [])
      : [];
    const matches = await this.slotsOfMat(matId);
    const queue = matches.filter((m) => m.status !== 'FINISHED');
    const current = currentOf(queue);
    const next = queue.find((m) => m.id !== current?.id) ?? null;
    const awaiting = matches.filter((m) => m.status === 'FINISHED');
    const ctx = await this.loadContext(this.db, matches);
    return {
      competition: this.competitionRef(competition),
      mat: { id: mat.id, number: mat.number, name: mat.name },
      session: this.sessionRef(session),
      myRoles,
      current: current ? await this.detailOf(user, scope, current, ctx) : null,
      next: next ? this.brief(next, ctx) : null,
      awaitingConfirmation: await this.pendingOf(user, scope, awaiting, ctx),
      serverTime: new Date().toISOString(),
    };
  }

  /** Раздел «Судейство»: ковры турнира в текущей сессии (свои — сверху), текущая схватка и ждущие подтверждения. */
  async officiating(user: AuthUser, competitionId: string): Promise<OfficiatingDto> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    await this.policy.assert(user, 'competition.view', scope);
    const [sessions, session, mats] = await Promise.all([
      this.crews.sessions(competitionId),
      this.crews.currentSession(competitionId),
      this.db.mat.findMany({ where: { competitionId }, orderBy: { number: 'asc' } }),
    ]);
    const roles = session
      ? await this.crews.rolesInSession(user.id, session.id)
      : new Map<string, MatCrewRole[]>();
    const rows = await this.db.matchSchedule.findMany({
      where: {
        competitionId,
        OR: [
          { match: { status: { in: [...UPCOMING] } } },
          { match: { status: 'FINISHED', result: { status: 'PROVISIONAL' } } },
        ],
      },
      include: { match: { include: MATCH_INCLUDE } },
      orderBy: [{ plannedAt: 'asc' }, { orderInMat: 'asc' }],
    });
    const byMat = new Map<string, MatchRecord[]>();
    for (const r of rows) {
      if (isNoMatch(r.match)) continue;
      byMat.set(r.matId, [...(byMat.get(r.matId) ?? []), r.match]);
    }
    const currents = mats
      .map((mat) => currentOf((byMat.get(mat.id) ?? []).filter((m) => m.status !== 'FINISHED')))
      .filter((m): m is MatchRecord => m !== null);
    const ctx = await this.loadContext(this.db, currents);
    const list: OfficiatingMatDto[] = mats.map((mat) => {
      const queue = byMat.get(mat.id) ?? [];
      const current = currentOf(queue.filter((m) => m.status !== 'FINISHED'));
      return {
        id: mat.id,
        number: mat.number,
        name: mat.name,
        isActive: mat.isActive,
        myRoles: roles.get(mat.id) ?? [],
        current: current ? this.brief(current, ctx) : null,
        awaitingConfirmation: queue.filter((m) => m.status === 'FINISHED').length,
      };
    });
    list.sort((a, b) => Number(b.myRoles.length > 0) - Number(a.myRoles.length > 0) || a.number - b.number);
    return {
      competition: this.competitionRef(competition),
      sessions: sessions.map((s) => this.sessionRef(s) as NonNullable<ReturnType<typeof this.sessionRef>>),
      currentSessionId: session?.id ?? null,
      mats: list,
      pendingConfirmations: rows.filter((r) => r.match.status === 'FINISHED').length,
    };
  }
}
