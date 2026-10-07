// Чтение расписания (Phase 6, §6; API.md, 6.2): раздел «Расписание» турнира и экран «Ковры». Право — competition.view
// (весь персонал турнира); allowedActions — schedule.manage/schedule.publish, доступные этому пользователю.
import { Injectable } from '@nestjs/common';
import {
  clockNowMs,
  type EntryScheduleMatch,
  type MatchState,
  type MatchStatus,
  type MatQueueDto,
  type MatQueueItemDto,
  type PermissionCode,
  type ScheduleDto,
  type ScheduleMatchDto,
  type UnassignedMatchDto,
} from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { BracketsService } from '../../brackets';
import { isPlayed, MatchesService, sideOf } from '../../matches';
import { CompetitionScopeService } from '../../competitions';
import { projectQueue } from '../domain/queue';
import { computeTimeline, type TimelineItem } from '../domain/timeline';
import { assembleSchedule, loadMinRestSeconds } from './schedule-assembly';

const CANDIDATES: readonly PermissionCode[] = ['schedule.manage', 'schedule.publish'];

const MATCH_INCLUDE = { participants: true } satisfies Prisma.MatchInclude;

const ITEM_INCLUDE = {
  match: { include: MATCH_INCLUDE },
} satisfies Prisma.MatchScheduleInclude;

type ItemRow = Prisma.MatchScheduleGetPayload<{ include: typeof ITEM_INCLUDE }>;

const QUEUE_INCLUDE = {
  match: { include: { participants: true, result: true } },
} satisfies Prisma.MatchScheduleInclude;

type QueueRow = Prisma.MatchScheduleGetPayload<{ include: typeof QUEUE_INCLUDE }>;

/** Проекция счёта схватки (MatchState из packages/contracts), записанная модулем судейства, или null. */
function stateOf(value: Prisma.JsonValue | null): MatchState | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as unknown as MatchState)
    : null;
}

function scoreOf(value: Prisma.JsonValue | null): { red: number; blue: number } | null {
  const state = stateOf(value);
  return state ? { red: state.red.points, blue: state.blue.points } : null;
}

function elapsedOf(value: Prisma.JsonValue | null, nowMs: number): number {
  const state = stateOf(value);
  return state ? clockNowMs(state.clock, nowMs, state.durationMs) : 0;
}

/** Схватка решена без игры (см. schedule-assembly.noMatch) — здесь дублируется, чтобы не тянуть весь модуль matches
 *  ради одной функции с иным набором полей участника. */
function isNoMatch(status: MatchStatus, played: boolean): boolean {
  if (status === 'CANCELLED') return true;
  return status === 'FINISHED' && !played;
}

@Injectable()
export class ScheduleQueriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly brackets: BracketsService,
    private readonly matches: MatchesService,
  ) {}

  async get(user: AuthUser, competitionId: string): Promise<ScheduleDto> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    await this.policy.assert(user, 'competition.view', scope);
    const allowedActions = await this.policy.allowedActions(user, scope, CANDIDATES);
    return this.build(this.db, competitionId, allowedActions);
  }

  /** Строится и вне запроса пользователя (ответ команд generate/patchItems/publish — та же сборка). */
  async build(db: Tx, competitionId: string, allowedActions: string[]): Promise<ScheduleDto> {
    const scheduleRow = await db.schedule.findUnique({
      where: { competitionId },
      include: { publishedBy: { select: { id: true, displayName: true } } },
    });

    const [categoryRows, itemRows, mats, sessions] = await Promise.all([
      db.competitionCategory.findMany({
        where: { competitionId },
        select: { id: true, nameRu: true, nameEn: true },
      }),
      db.matchSchedule.findMany({
        where: { competitionId },
        include: ITEM_INCLUDE,
        orderBy: [{ sessionId: 'asc' }, { matId: 'asc' }, { orderInMat: 'asc' }],
      }),
      db.mat.findMany({ where: { competitionId }, orderBy: { number: 'asc' } }),
      db.session.findMany({ where: { competitionId }, orderBy: { startsAt: 'asc' } }),
    ]);
    const categoryName = new Map(categoryRows.map((c) => [c.id, { ru: c.nameRu, en: c.nameEn }]));

    const entryIds = [
      ...new Set(
        itemRows.flatMap((r) => r.match.participants.map((p) => p.entryId).filter((x): x is string => !!x)),
      ),
    ];
    const entries = entryIds.length
      ? await db.entry.findMany({ where: { id: { in: entryIds } }, select: { id: true, publicName: true } })
      : [];
    const publicNameOf = new Map(entries.map((e) => [e.id, e.publicName]));

    const items: ScheduleMatchDto[] = itemRows.map((row) =>
      this.toMatchDto(row, categoryName.get(row.match.categoryId) ?? { ru: '', en: '' }, publicNameOf),
    );

    const unassignedRows = await db.match.findMany({
      where: { competitionId, matchNumber: { not: null }, schedule: null },
      include: MATCH_INCLUDE,
    });
    const activeMats = mats.filter((m) => m.isActive).length;
    const unassigned: UnassignedMatchDto[] = unassignedRows
      .filter((m) => !isNoMatch(m.status, isPlayed(m)))
      .map((m) => ({
        matchId: m.id,
        matchNumber: m.matchNumber,
        categoryId: m.categoryId,
        categoryName: categoryName.get(m.categoryId) ?? { ru: '', en: '' },
        roundLabel: m.roundLabel,
        reason: activeMats === 0 ? 'no_active_mats' : 'no_session_capacity',
      }));

    const capacitySeconds = sessions.reduce(
      (sum, s) => sum + Math.floor((s.endsAt.getTime() - s.startsAt.getTime()) / 1000),
      0,
    );
    const matLoad = mats.map((mat) => ({
      matId: mat.id,
      totalSeconds: items.filter((i) => i.matId === mat.id).reduce((sum, i) => sum + i.durationSeconds, 0),
      capacitySeconds,
    }));

    const warnings = await this.warningsFor(db, competitionId, itemRows);

    const schedule = scheduleRow ?? {
      status: 'DRAFT' as const,
      version: 1,
      matChangeoverSeconds: 60,
      publishedAt: null,
      publishedBy: null,
    };
    return {
      competitionId,
      status: schedule.status,
      matChangeoverSeconds: schedule.matChangeoverSeconds,
      version: schedule.version,
      publishedAt: schedule.publishedAt?.toISOString() ?? null,
      publishedBy: schedule.publishedBy
        ? { id: schedule.publishedBy.id, displayName: schedule.publishedBy.displayName }
        : null,
      items,
      unassigned,
      warnings,
      matLoad,
      allowedActions,
    };
  }

  private toMatchDto(
    row: ItemRow | QueueRow,
    name: { ru: string; en: string },
    publicNameOf: ReadonlyMap<string, string>,
  ): ScheduleMatchDto {
    const match = row.match;
    const red = sideOf(match, 'RED');
    const blue = sideOf(match, 'BLUE');
    const duration = match.durationSeconds ?? 0;
    const endsAt = new Date(row.plannedAt.getTime() + duration * 1000);
    return {
      matchId: match.id,
      matchNumber: match.matchNumber,
      publicId: match.publicId,
      categoryId: match.categoryId,
      categoryName: name,
      roundLabel: match.roundLabel,
      red: {
        entryId: red?.entryId ?? null,
        publicName: red?.entryId ? (publicNameOf.get(red.entryId) ?? null) : null,
        bye: red?.isBye ?? false,
      },
      blue: {
        entryId: blue?.entryId ?? null,
        publicName: blue?.entryId ? (publicNameOf.get(blue.entryId) ?? null) : null,
        bye: blue?.isBye ?? false,
      },
      status: match.status,
      durationSeconds: duration,
      sessionId: row.sessionId,
      matId: row.matId,
      orderInMat: row.orderInMat,
      plannedAt: row.plannedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      locked: row.locked,
      noMatch: isNoMatch(match.status, isPlayed(match)),
    };
  }

  /**
   * Предупреждения по текущей расстановке — пересчёт computeTimeline поверх зависимостей опубликованных сеток
   * (свежих на момент чтения). Схватки «без схватки» (см. schedule-assembly.noMatch) не участвуют — они пропускаются
   * в очереди ковра и не нуждаются в отдыхе. Зависимость вне текущего набора схваток (не должно происходить —
   * запрет на новую версию жеребьёвки при начатых схватках) тихо не даёт предупреждения для неё.
   */
  private async warningsFor(
    db: Tx,
    competitionId: string,
    itemRows: readonly ItemRow[],
  ): Promise<ScheduleDto['warnings']> {
    const scheduled = itemRows.filter((r) => !isNoMatch(r.match.status, isPlayed(r.match)));
    if (scheduled.length === 0) return [];
    const [assembly, minRestSeconds, sessions] = await Promise.all([
      assembleSchedule(db, this.brackets, this.matches, competitionId),
      loadMinRestSeconds(db, competitionId),
      db.session.findMany({ where: { competitionId }, select: { id: true, startsAt: true, endsAt: true } }),
    ]);
    const scheduleRow = await db.schedule.findUnique({
      where: { competitionId },
      select: { matChangeoverSeconds: true },
    });
    const byId = new Map(assembly.matches.map((m) => [m.id, m]));
    const items: TimelineItem[] = [];
    for (const row of scheduled) {
      const input = byId.get(row.matchId);
      if (!input) continue;
      items.push({
        matchId: row.matchId,
        sessionId: row.sessionId,
        matId: row.matId,
        orderInMat: row.orderInMat,
        durationSeconds: input.durationSeconds,
        dependsOn: input.dependsOn,
        athleteIds: input.athleteIds,
      });
    }
    if (items.length === 0) return [];
    const result = computeTimeline({
      items,
      sessions: sessions.map((s) => ({ id: s.id, startsAt: toEpoch(s.startsAt), endsAt: toEpoch(s.endsAt) })),
      minRestSeconds,
      matChangeoverSeconds: scheduleRow?.matChangeoverSeconds ?? 60,
    });
    return result.warnings;
  }

  /**
   * Экран «Ковры» (план Phase 6, §6; Phase 7a, §1): текущая схватка (идёт или на паузе, иначе вызванная, иначе
   * первая в очереди) и до трёх следующих с ожидаемым временем начала по фактическому ходу ковра; сыгранные
   * схватки, ждущие подтверждения результата. «Без схватки» пропускаются.
   */
  async matQueue(user: AuthUser, matId: string): Promise<MatQueueDto> {
    const mat = await this.db.mat.findUnique({ where: { id: matId } });
    if (!mat) throw new DomainError('NOT_FOUND', { resource: 'mat' });
    const competition = await this.competitions.require(mat.competitionId);
    const scope = await this.competitions.scopeFor(competition);
    await this.policy.assert(user, 'competition.view', scope);

    const [rows, schedule] = await Promise.all([
      this.db.matchSchedule.findMany({
        where: {
          matId,
          OR: [
            { match: { status: { in: ['SCHEDULED', 'READY', 'IN_PROGRESS', 'PAUSED'] } } },
            { match: { status: 'FINISHED', result: { status: 'PROVISIONAL' } } },
          ],
        },
        include: QUEUE_INCLUDE,
        orderBy: { plannedAt: 'asc' },
      }),
      this.db.schedule.findUnique({
        where: { competitionId: mat.competitionId },
        select: { matChangeoverSeconds: true },
      }),
    ]);
    const { categoryName, publicNameOf } = await this.queueLabels(rows);

    const live = rows.filter(
      (r) => r.match.status !== 'FINISHED' && !isNoMatch(r.match.status, isPlayed(r.match)),
    );
    const projection = projectQueue(
      live.map((r) => ({
        matchId: r.matchId,
        plannedAt: r.plannedAt.getTime(),
        durationSeconds: r.match.durationSeconds ?? 0,
        status: r.match.status,
        startedAt: r.match.startedAt?.getTime() ?? null,
        elapsedMs: elapsedOf(r.match.state, Date.now()),
      })),
      Date.now(),
      schedule?.matChangeoverSeconds ?? 60,
    );
    const toItem = (r: QueueRow): MatQueueItemDto =>
      this.queueItem(r, categoryName, publicNameOf, projection.expectedAt.get(r.matchId));
    const queue = live.map(toItem);
    const current =
      queue.find((m) => m.status === 'IN_PROGRESS' || m.status === 'PAUSED') ??
      queue.find((m) => m.status === 'READY') ??
      queue.find((m) => m.red.entryId !== null && m.blue.entryId !== null) ??
      queue[0] ??
      null;
    const next = queue.filter((m) => m.matchId !== current?.matchId).slice(0, 3);
    const awaitingConfirmation = rows.filter((r) => r.match.status === 'FINISHED').map(toItem);
    return {
      matId: mat.id,
      matNumber: mat.number,
      matName: mat.name,
      current,
      next,
      awaitingConfirmation,
      delaySeconds: projection.delaySeconds,
    };
  }

  /** Строка очереди ковра: схватка, ожидаемое начало, счёт (по журналу или результату) и исход. */
  private queueItem(
    r: QueueRow,
    categoryName: ReadonlyMap<string, { ru: string; en: string }>,
    publicNameOf: ReadonlyMap<string, string>,
    expectedAt: number | undefined,
  ): MatQueueItemDto {
    const result = r.match.result;
    return {
      ...this.toMatchDto(r, categoryName.get(r.match.categoryId) ?? { ru: '', en: '' }, publicNameOf),
      expectedAt: new Date(expectedAt ?? r.plannedAt.getTime()).toISOString(),
      resultStatus: result?.status ?? null,
      score: result ? { red: result.redScore ?? 0, blue: result.blueScore ?? 0 } : scoreOf(r.match.state),
      winnerSide: result?.winnerSide ?? null,
      method: result?.method ?? null,
    };
  }

  /** Названия категорий и «Фамилия И.» участников строк очереди ковра. */
  private async queueLabels(rows: QueueRow[]): Promise<{
    categoryName: Map<string, { ru: string; en: string }>;
    publicNameOf: Map<string, string>;
  }> {
    const categoryRows = await this.db.competitionCategory.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.match.categoryId))] } },
      select: { id: true, nameRu: true, nameEn: true },
    });
    const entryIds = [
      ...new Set(
        rows.flatMap((r) => r.match.participants.map((p) => p.entryId).filter((x): x is string => !!x)),
      ),
    ];
    const entries = entryIds.length
      ? await this.db.entry.findMany({
          where: { id: { in: entryIds } },
          select: { id: true, publicName: true },
        })
      : [];
    return {
      categoryName: new Map(categoryRows.map((c) => [c.id, { ru: c.nameRu, en: c.nameEn }])),
      publicNameOf: new Map(entries.map((e) => [e.id, e.publicName])),
    };
  }

  /**
   * Расписание участников заявки (Phase 6, §6/§8): ковёр, номер и плановое время схваток спортсменов — только
   * после публикации расписания турнира (до публикации места могут ещё поменяться, клубу их не показываем).
   * Используется модулем registrations для карточки заявки клуба (GET /applications/{id}); право на сами
   * участия проверяет вызывающий модуль, здесь — только сборка данных. Схватки «без схватки» (см. isNoMatch
   * выше) пропускаются — они никогда не состоятся, хотя место в расписании у них могло сохраниться.
   */
  async scheduledMatchesForEntries(
    competitionId: string,
    entryIds: readonly string[],
  ): Promise<Map<string, EntryScheduleMatch[]>> {
    const byEntry = new Map<string, EntryScheduleMatch[]>();
    if (entryIds.length === 0) return byEntry;
    const schedule = await this.db.schedule.findUnique({
      where: { competitionId },
      select: { status: true },
    });
    if (schedule?.status !== 'PUBLISHED') return byEntry;

    const rows = await this.db.matchParticipant.findMany({
      where: { entryId: { in: [...entryIds] }, match: { schedule: { isNot: null } } },
      select: {
        entryId: true,
        match: {
          select: {
            id: true,
            matchNumber: true,
            roundLabel: true,
            status: true,
            participants: { select: { entryId: true } },
            schedule: {
              select: { plannedAt: true, mat: { select: { id: true, number: true, name: true } } },
            },
          },
        },
      },
    });
    for (const row of rows) {
      const match = row.match;
      if (!row.entryId || !match.schedule) continue;
      if (isNoMatch(match.status, isPlayedRow(match.status, match.participants))) continue;
      const list = byEntry.get(row.entryId) ?? [];
      list.push({
        matchId: match.id,
        matchNumber: match.matchNumber,
        roundLabel: match.roundLabel,
        matId: match.schedule.mat.id,
        matNumber: match.schedule.mat.number,
        matName: match.schedule.mat.name,
        plannedAt: match.schedule.plannedAt.toISOString(),
      });
      byEntry.set(row.entryId, list);
    }
    for (const list of byEntry.values()) list.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
    return byEntry;
  }
}

/** Сыграна ли схватка — минимальный вариант matches.isPlayed по урезанной выборке участников (без полных строк). */
function isPlayedRow(status: MatchStatus, participants: readonly { entryId: string | null }[]): boolean {
  return status === 'FINISHED' && participants.length === 2 && participants.every((p) => p.entryId !== null);
}

function toEpoch(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}
