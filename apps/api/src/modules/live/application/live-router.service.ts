// Публикация пачки изменений в живые каналы (Phase 8a; API.md, 7.2): служебные каналы турнира, ковров и схваток
// получают «что изменилось» (экраны перечитывают данные по REST), публичные каналы ковров и схваток — состояние
// для табло (ADR-15: публичная проекция), публичный канал турнира — темы изменений.
import { Injectable, Logger } from '@nestjs/common';
import { LIVE_LAST_RESULT_MS, LIVE_TOPICS, liveChannel, type LiveTopic } from '@sde/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { isPublicCompetition, ScoreboardService } from '../../refereeing';
import {
  BoundedVersionMemory,
  type ChangeRow,
  type CompetitionChanges,
  changedPayload,
  groupChanges,
  PUBLIC_TOPICS,
} from '../domain/change-routing';
import { LivePublisherService } from './live-publisher.service';

interface TouchedMatch {
  id: string;
  publicId: string;
  status: string;
  matId: string | null;
  finishedAt: Date | null;
  schedule: { matId: string } | null;
}

const TOUCHED_SELECT = {
  id: true,
  publicId: true,
  status: true,
  matId: true,
  finishedAt: true,
  schedule: { select: { matId: true } },
} as const;

/** Схватка вызвана, идёт или на паузе. */
const LIVE_MATCH_STATUSES = ['READY', 'IN_PROGRESS', 'PAUSED'] as const;

/** Турниры, где идут или вот-вот начнутся схватки: при пересинхронизации — и ковры, и идущие схватки. */
const OPERATING_STATUSES = ['SCHEDULED', 'IN_PROGRESS'] as const;
/** Турниры с живыми служебными экранами (прибытие, взвешивание, допуск, жеребьёвка, судейство). */
const ACTIVE_STATUSES = ['REGISTRATION_CLOSED', 'CHECK_IN', 'DRAWING', ...OPERATING_STATUSES] as const;

/**
 * Публичное состояние схватки — только там, где на неё смотрят: вызвана, идёт, на паузе или завершена в последний
 * час. Публикация итогов категории меняет результаты всех её схваток — давние схватки табло не пересчитывает.
 */
function watched(m: TouchedMatch, now: number): boolean {
  if ((LIVE_MATCH_STATUSES as readonly string[]).includes(m.status)) return true;
  return (
    m.status === 'FINISHED' && m.finishedAt !== null && now - m.finishedAt.getTime() < LIVE_LAST_RESULT_MS
  );
}

@Injectable()
export class LiveRouterService {
  private readonly logger = new Logger('LiveRouter');
  private memory = new BoundedVersionMemory();

  constructor(
    private readonly db: PrismaService,
    private readonly publisher: LivePublisherService,
    private readonly scoreboard: ScoreboardService,
  ) {}

  /** Новый ведущий узел: прежние версии схваток неизвестны (первое изменение каждой — как изменение статуса). */
  reset(): void {
    this.memory = new BoundedVersionMemory();
  }

  async handle(rows: readonly ChangeRow[]): Promise<void> {
    for (const g of groupChanges(rows, this.memory)) await this.safely(() => this.publishCompetition(g));
  }

  /**
   * Пересинхронизация (новый ведущий узел, восстановленное прослушивание): изменения, записанные, пока ленту никто
   * не слушал, не пришли. Служебным экранам действующих турниров — «перечитать всё», табло — состояние ковров и
   * идущих схваток заново.
   */
  async resyncAll(): Promise<void> {
    const competitions = await this.db.competition.findMany({
      where: { deletedAt: null, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, status: true },
    });
    for (const c of competitions) {
      const operating = (OPERATING_STATUSES as readonly string[]).includes(c.status);
      await this.safely(async () => {
        const live = operating
          ? await this.db.match.findMany({
              where: { competitionId: c.id, status: { in: [...LIVE_MATCH_STATUSES] } },
              select: { id: true },
            })
          : [];
        await this.publishCompetition({
          competitionId: c.id,
          topics: new Set(LIVE_TOPICS),
          categoryIds: new Set(),
          matIds: new Set(),
          matchIds: new Set(live.map((m) => m.id)),
          statusMatchIds: new Set(),
          deletedMatchIds: new Set(),
          allMats: operating,
        });
      });
    }
  }

  /** Сбой одной проекции (запрос к БД) не мешает остальным каналам пачки. */
  private async safely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn({ err }, 'Live publication skipped');
    }
  }

  private async publishCompetition(g: CompetitionChanges): Promise<void> {
    const competition = await this.db.competition.findUnique({
      where: { id: g.competitionId },
      select: { id: true, slug: true, status: true, deletedAt: true },
    });
    if (!competition) return;
    const { matches, mats } = await this.targets(g);
    await this.publishOps(g, mats);
    if (isPublicCompetition(competition)) await this.publishPublic(competition.slug, g, mats, matches);
  }

  /** Затронутые схватки (кроме удалённых) и ковры: из строк, фактический ковёр и ковёр расписания схваток. */
  private async targets(g: CompetitionChanges): Promise<{ matches: TouchedMatch[]; mats: string[] }> {
    const touched = [...g.matchIds].filter((id) => !g.deletedMatchIds.has(id));
    const matches = touched.length
      ? await this.db.match.findMany({ where: { id: { in: touched } }, select: TOUCHED_SELECT })
      : [];
    if (g.allMats) {
      const all = await this.db.mat.findMany({
        where: { competitionId: g.competitionId },
        select: { id: true },
      });
      return { matches, mats: all.map((m) => m.id) };
    }
    const mats = new Set(g.matIds);
    for (const m of matches) {
      if (m.matId) mats.add(m.matId);
      if (m.schedule?.matId) mats.add(m.schedule.matId);
    }
    return { matches, mats: [...mats] };
  }

  /** Служебные каналы: турнир — только изменения статуса и данных; ковры и схватки — и счёт. */
  private async publishOps(g: CompetitionChanges, mats: readonly string[]): Promise<void> {
    if (g.topics.size > 0)
      await this.publisher.publish({
        channel: liveChannel.opsCompetition(g.competitionId),
        type: 'changed',
        payload: changedPayload(g),
      });
    for (const id of g.matchIds)
      await this.publisher.publish({
        channel: liveChannel.opsMatch(id),
        type: 'changed',
        payload: changedPayload(g, { topics: ['matches'], matchIds: [id] }),
      });
    for (const matId of mats)
      await this.publisher.publish({
        channel: liveChannel.opsMat(matId),
        type: 'changed',
        payload: changedPayload(g, { matIds: [matId] }),
      });
  }

  /** Публичные каналы: темы изменений турнира (без идентификаторов), состояние табло ковров и схваток. */
  private async publishPublic(
    slug: string,
    g: CompetitionChanges,
    mats: readonly string[],
    matches: readonly TouchedMatch[],
  ): Promise<void> {
    const topics = [...g.topics].filter((t): t is LiveTopic => PUBLIC_TOPICS.includes(t));
    if (topics.length > 0)
      await this.publisher.publish({
        channel: liveChannel.publicCompetition(slug),
        type: 'changed',
        payload: { topics, categoryIds: [], matIds: [], matchIds: [] },
      });
    for (const matId of mats)
      await this.safely(async () => {
        const state = await this.scoreboard.matStateById(matId);
        if (state)
          await this.publisher.publish({
            channel: state.channel,
            type: 'mat.state',
            payload: state,
            retain: true,
          });
      });
    const now = Date.now();
    for (const m of matches) {
      if (!watched(m, now)) continue;
      await this.safely(async () => {
        const state = await this.scoreboard.matchState(m.publicId);
        if (state)
          await this.publisher.publish({
            channel: liveChannel.publicMatch(m.publicId),
            type: 'match.state',
            payload: state,
            retain: true,
          });
      });
    }
  }
}
