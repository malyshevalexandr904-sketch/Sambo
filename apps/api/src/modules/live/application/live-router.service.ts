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
    const matIds = new Set(g.matIds);
    for (const m of matches) {
      if (m.matId) matIds.add(m.matId);
      if (m.schedule?.matId) matIds.add(m.schedule.matId);
    }
    const mats = g.allMats
      ? await this.db.mat.findMany({ where: { competitionId: g.competitionId }, select: { id: true } })
      : [...matIds].map((id) => ({ id }));

    // Служебные каналы: турнир — только изменения статуса и данных; ковры и схватки — и счёт.
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
    for (const mat of mats)
      await this.publisher.publish({
        channel: liveChannel.opsMat(mat.id),
        type: 'changed',
        payload: changedPayload(g, { matIds: [mat.id] }),
      });

    if (!isPublicCompetition(competition)) return;
    const publicTopics = [...g.topics].filter((t): t is LiveTopic => PUBLIC_TOPICS.includes(t));
    if (publicTopics.length > 0)
      await this.publisher.publish({
        channel: liveChannel.publicCompetition(competition.slug),
        type: 'changed',
        payload: { topics: publicTopics, categoryIds: [], matIds: [], matchIds: [] },
      });
    for (const mat of mats) {
      const state = await this.scoreboard.matStateById(mat.id);
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
