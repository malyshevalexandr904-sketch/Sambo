// Публикация пачки изменений в живые каналы (Phase 8a; API.md, 7.2): служебные каналы турнира, ковров и схваток
// получают «что изменилось» (экраны перечитывают данные по REST), публичные каналы ковров и схваток — состояние
// для табло (ADR-15: публичная проекция), публичный канал турнира — темы изменений.
import { Injectable } from '@nestjs/common';
import { liveChannel, type LiveTopic } from '@sde/contracts';
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
  schedule: { matId: string } | null;
}

/** Публичное состояние схватки — только там, где на неё смотрят: вызвана, идёт, на паузе или только что завершена. */
const PUBLIC_MATCH_STATUSES = new Set(['READY', 'IN_PROGRESS', 'PAUSED', 'FINISHED']);

@Injectable()
export class LiveRouterService {
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
    for (const g of groupChanges(rows, this.memory)) await this.publishCompetition(g);
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
      ? await this.db.match.findMany({
          where: { id: { in: touched } },
          select: {
            id: true,
            publicId: true,
            status: true,
            matId: true,
            schedule: { select: { matId: true } },
          },
        })
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
    for (const matId of mats) {
      const state = await this.scoreboard.matStateById(matId);
      if (state)
        await this.publisher.publish({
          channel: state.channel,
          type: 'mat.state',
          payload: state,
          retain: true,
        });
    }
    for (const m of matches) {
      if (!PUBLIC_MATCH_STATUSES.has(m.status)) continue;
      const state = await this.scoreboard.matchState(m.publicId);
      if (state)
        await this.publisher.publish({
          channel: liveChannel.publicMatch(m.publicId),
          type: 'match.state',
          payload: state,
          retain: true,
        });
    }
  }
}
