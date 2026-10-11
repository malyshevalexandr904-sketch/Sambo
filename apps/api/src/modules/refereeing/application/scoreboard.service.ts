// Табло ковра (Phase 8a; ADR-15 — публичная проекция): текущая схватка (идёт или вызвана), последняя завершённая и
// следующая пара ковра опубликованного турнира. «Фамилия И.» и клуб (Q-04); без действующего согласия на
// распространение ПДн имя не отдаётся — табло показывает угол. Время — по часам сервера: журнал идущей схватки
// пересчитывается с моментами, сведёнными к часам сервера (toServerClock), табло досчитывает идущее время само.
import { Injectable } from '@nestjs/common';
import {
  type ConsentKind,
  type LiveMatchDto,
  type LiveSideDto,
  liveChannel,
  LIVE_LAST_RESULT_MS,
  type LocalizedText,
  type PublicMatStateDto,
  replayEvents,
  type RuleSetParametersV1,
  type Side,
} from '@sde/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ConsentsService } from '../../consents';
import { MATCH_INCLUDE, type MatchRecord, MatchStoreService, sideOf } from '../../matches';
import { toServerClock } from '../domain/server-clock';
import { bothKnown, isNoMatch, UPCOMING } from './mat-queue';
import { MatchContextService, toScoringEvents } from './match-context.service';
import { EMPTY_TEXT, stateOf } from './match-mapper';

const COMPETITION_SELECT = {
  id: true,
  slug: true,
  name: true,
  timezone: true,
  status: true,
  deletedAt: true,
} as const;

interface CompetitionRef {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: string;
  deletedAt: Date | null;
}

interface MatRef {
  id: string;
  number: number;
  name: string | null;
  competition: CompetitionRef;
}

interface SideView {
  publicName: string;
  club: string | null;
  region: string | null;
  athletePersonId: string;
}

interface LiveContext {
  categories: Map<string, LocalizedText>;
  entries: Map<string, SideView>;
  /** Лица с действующим согласием на распространение ПДн (общим или на этот турнир). */
  distribution: Set<string>;
  rules: RuleSetParametersV1 | null;
}

/** Публичный — опубликованный и не удалённый турнир (как публичная страница, ADR-15). */
export const isPublicCompetition = (c: { status: string; deletedAt: Date | null }): boolean =>
  c.deletedAt === null && c.status !== 'DRAFT';

const LIVE: readonly string[] = ['IN_PROGRESS', 'PAUSED'];

@Injectable()
export class ScoreboardService {
  constructor(
    private readonly db: PrismaService,
    private readonly context: MatchContextService,
    private readonly store: MatchStoreService,
    private readonly consents: ConsentsService,
  ) {}

  /** Состояние ковра по id; турнир не опубликован или ковра нет — null. */
  async matStateById(matId: string): Promise<PublicMatStateDto | null> {
    const mat = await this.db.mat.findUnique({
      where: { id: matId },
      select: { id: true, number: true, name: true, competition: { select: COMPETITION_SELECT } },
    });
    return mat && isPublicCompetition(mat.competition) ? this.build(mat) : null;
  }

  /** Состояние ковра по каналу `public:mat:{slug}:{номер}`. */
  async matStateBySlug(slug: string, matNumber: number): Promise<PublicMatStateDto | null> {
    const mat = await this.db.mat.findFirst({
      where: { number: matNumber, competition: { slug } },
      select: { id: true, number: true, name: true, competition: { select: COMPETITION_SELECT } },
    });
    return mat && isPublicCompetition(mat.competition) ? this.build(mat) : null;
  }

  /** Публичное состояние схватки по publicId (канал `public:match`). */
  async matchState(publicId: string): Promise<LiveMatchDto | null> {
    const m = await this.db.match.findUnique({ where: { publicId }, include: MATCH_INCLUDE });
    if (!m || isNoMatch(m)) return null;
    const competition = await this.db.competition.findUnique({
      where: { id: m.competitionId },
      select: COMPETITION_SELECT,
    });
    if (!competition || !isPublicCompetition(competition)) return null;
    const ctx = await this.loadContext(competition.id, [m]);
    return this.liveMatch(m, ctx);
  }

  private async build(mat: MatRef): Promise<PublicMatStateDto> {
    const rows = await this.db.matchSchedule.findMany({
      where: { matId: mat.id, match: { status: { in: [...UPCOMING] } } },
      include: { match: { include: MATCH_INCLUDE } },
      orderBy: [{ plannedAt: 'asc' }, { orderInMat: 'asc' }],
    });
    const queue = rows.map((r) => r.match).filter((m) => !isNoMatch(m));
    const current =
      queue.find((m) => LIVE.includes(m.status)) ?? queue.find((m) => m.status === 'READY') ?? null;
    const rest = queue.filter((m) => m.id !== current?.id);
    const next = rest.find(bothKnown) ?? rest[0] ?? null;
    // Последняя схватка, которую провела бригада на этом ковре (исходы системы — BYE, автоматическая неявка — нет).
    const last = await this.db.match.findFirst({
      where: {
        status: 'FINISHED',
        schedule: { matId: mat.id },
        finishedAt: { gte: new Date(Date.now() - LIVE_LAST_RESULT_MS) },
        result: { proposedById: { not: null } },
      },
      include: MATCH_INCLUDE,
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    });
    const shown = [current, next, last].filter((m): m is MatchRecord => m !== null && !isNoMatch(m));
    const ctx = await this.loadContext(mat.competition.id, shown);
    const live = async (m: MatchRecord | null) => (m && !isNoMatch(m) ? this.liveMatch(m, ctx) : null);
    const c = mat.competition;
    return {
      competition: { slug: c.slug, name: c.name, timezone: c.timezone },
      mat: { id: mat.id, number: mat.number, name: mat.name },
      channel: liveChannel.publicMat(c.slug, mat.number),
      current: await live(current),
      last: await live(last),
      next: await live(next),
      serverTime: new Date().toISOString(),
    };
  }

  private async loadContext(competitionId: string, matches: readonly MatchRecord[]): Promise<LiveContext> {
    const entryIds = [
      ...new Set(
        matches.flatMap((m) => m.participants.map((p) => p.entryId)).filter((x): x is string => !!x),
      ),
    ];
    const [categories, entries] = await Promise.all([
      this.db.competitionCategory.findMany({
        where: { id: { in: [...new Set(matches.map((m) => m.categoryId))] } },
        select: { id: true, nameRu: true, nameEn: true },
      }),
      entryIds.length
        ? this.db.entry.findMany({
            where: { id: { in: entryIds } },
            select: {
              id: true,
              publicName: true,
              snapClubName: true,
              snapRegionName: true,
              athlete: { select: { personId: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const personIds = [...new Set(entries.map((e) => e.athlete.personId))];
    const kinds: Map<string, Set<ConsentKind>> = personIds.length
      ? await this.consents.activeKinds(this.db, personIds, competitionId)
      : new Map<string, Set<ConsentKind>>();
    const distribution = new Set(personIds.filter((id) => kinds.get(id)?.has('PD_DISTRIBUTION')));
    const rules = matches.some((m) => LIVE.includes(m.status) || m.state !== null)
      ? await this.context.rules(this.db, competitionId).catch(() => null)
      : null;
    return {
      categories: new Map(categories.map((c) => [c.id, { ru: c.nameRu, en: c.nameEn }])),
      entries: new Map(
        entries.map((e) => [
          e.id,
          {
            publicName: e.publicName,
            club: e.snapClubName,
            region: e.snapRegionName,
            athletePersonId: e.athlete.personId,
          },
        ]),
      ),
      distribution,
      rules,
    };
  }

  private side(m: MatchRecord, side: Side, ctx: LiveContext): LiveSideDto {
    const entryId = sideOf(m, side)?.entryId ?? null;
    const e = entryId ? ctx.entries.get(entryId) : undefined;
    if (!e) return { name: null, hidden: false, club: null, region: null };
    const visible = ctx.distribution.has(e.athletePersonId);
    return { name: visible ? e.publicName : null, hidden: !visible, club: e.club, region: e.region };
  }

  private async liveMatch(m: MatchRecord, ctx: LiveContext): Promise<LiveMatchDto> {
    let state = stateOf(m.state);
    // Идущая схватка: счёт по журналу с моментами по часам сервера (таймеры табло не зависят от часов планшета).
    if (state && LIVE.includes(m.status) && ctx.rules) {
      const events = await this.store.events(null, m.id);
      const timed = toScoringEvents(events).map((e, i) => ({
        ...e,
        deviceId: events[i]?.deviceId ?? null,
        serverTime: (events[i]?.serverTime ?? new Date()).toISOString(),
      }));
      state = replayEvents(toServerClock(timed), ctx.rules, state.durationMs);
    }
    const maxHoldMs = ctx.rules ? Math.max(0, ...ctx.rules.hold.thresholds.map((t) => t.seconds)) * 1000 : 0;
    const durationMs = state?.durationMs ?? (m.durationSeconds ? m.durationSeconds * 1000 : null);
    const r = m.result;
    return {
      publicId: m.publicId,
      number: m.matchNumber,
      roundLabel: m.roundLabel,
      category: ctx.categories.get(m.categoryId) ?? EMPTY_TEXT,
      status: m.status,
      red: this.side(m, 'RED', ctx),
      blue: this.side(m, 'BLUE', ctx),
      score: state
        ? {
            red: { points: state.red.points, penalties: [...state.red.penalties] },
            blue: { points: state.blue.points, penalties: [...state.blue.penalties] },
          }
        : null,
      clock: state
        ? {
            running: state.clock.running,
            elapsedMs: state.clock.elapsedMs,
            durationMs: state.durationMs,
            at: state.clock.at,
          }
        : durationMs !== null
          ? { running: false, elapsedMs: 0, durationMs, at: null }
          : null,
      hold:
        state?.hold && LIVE.includes(m.status)
          ? { side: state.hold.side, startedAt: state.hold.startedAt, maxMs: maxHoldMs }
          : null,
      result: r
        ? {
            status: r.status,
            winnerSide: r.winnerSide,
            method: r.method,
            methodDetail: r.methodDetail,
            redScore: r.redScore,
            blueScore: r.blueScore,
          }
        : null,
      finishedAt: m.finishedAt?.toISOString() ?? null,
      version: m.version,
      seq: m.stateSeq,
    };
  }
}
