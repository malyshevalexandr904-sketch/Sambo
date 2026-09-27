// Сетки (ARCHITECTURE.md, 14.4; DATABASE.md, 3.6): граф опубликованной жеребьёвки, начальное состояние (BYE
// первого круга), схватки узлов, движок продвижения и удаление сетки при новой версии жеребьёвки.
// Состояние сетки не хранится отдельно: оно пересчитывается из жеребьёвки и сыгранных схваток, а стороны схваток
// приводятся к нему — так продвижение, BYE и утешительные схватки не расходятся с графом.
import { Injectable } from '@nestjs/common';
import type { BracketNodeDto, BracketStage, CompetitionFormatCode, Side } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { isPlayed, type MatchRecord, MatchesService } from '../../matches';
import type { BracketGraph, BracketState, Outcome } from '../domain/graph';
import { type FormatStrategy, resolveFormat, strategyFor } from '../domain/strategies';
import {
  type MatchDurations,
  matchSpec,
  nodeDtos,
  nodeRows,
  nodeState,
  numberingOrder,
  STAGE_ORDER,
} from './bracket-mapping';

export interface SlotRow {
  position: number;
  entryId: string | null;
}

export interface BracketSource {
  drawId: string;
  competitionId: string;
  categoryId: string;
  format: CompetitionFormatCode;
  slots: SlotRow[];
  durations: MatchDurations;
}

interface LiveBracket {
  graph: BracketGraph;
  state: BracketState;
  nodeIds: Map<string, string>;
  matchByKey: Map<string, MatchRecord>;
  competitionId: string;
  categoryId: string;
}

const slotMap = (slots: SlotRow[]) => new Map(slots.map((s) => [s.position, s.entryId]));

function requireStrategy(format: CompetitionFormatCode): FormatStrategy {
  const strategy = strategyFor(format);
  if (!strategy) throw new Error(`No bracket strategy for ${format}`);
  return strategy;
}

@Injectable()
export class BracketsService {
  constructor(
    private readonly db: PrismaService,
    private readonly matches: MatchesService,
    private readonly audit: AuditService,
  ) {}

  /** Предпросмотр черновика: те же узлы и начальное состояние (BYE), без схваток. */
  preview(format: CompetitionFormatCode, slots: SlotRow[]): BracketNodeDto[] {
    const strategy = requireStrategy(format);
    const graph = strategy.build(slots.length);
    return nodeDtos(graph, resolveFormat(strategy, graph, slotMap(slots)));
  }

  /** Публикация жеребьёвки: этапы, узлы со ссылками, схватки; BYE первого круга решаются сразу. */
  async createFromDraw(tx: Tx, src: BracketSource): Promise<void> {
    const strategy = requireStrategy(src.format);
    const graph = strategy.build(src.slots.length);
    const stages = [...new Set(graph.nodes.map((n) => n.stage))];
    const bracketIds = new Map<BracketStage, string>(stages.map((s) => [s, uuidv7()]));
    await tx.bracket.createMany({
      data: stages.map((stage) => ({
        id: bracketIds.get(stage) as string,
        competitionId: src.competitionId,
        categoryId: src.categoryId,
        drawId: src.drawId,
        kind: stage,
        format: src.format,
        stageOrder: STAGE_ORDER[stage],
      })),
    });
    const ids = new Map(graph.nodes.map((n) => [n.key, uuidv7()]));
    // Одна вставка: ссылки узлов друг на друга проверяются в конце оператора.
    await tx.bracketNode.createMany({ data: nodeRows(graph, ids, bracketIds, src.competitionId) });
    const state = resolveFormat(strategy, graph, slotMap(src.slots));
    await this.matches.createForBracket(
      tx,
      src.competitionId,
      src.categoryId,
      numberingOrder(graph).map((n) =>
        matchSpec(n, nodeState(state, n.key), ids.get(n.key) as string, src.durations),
      ),
    );
  }

  private async live(tx: Tx | null, drawId: string): Promise<LiveBracket | null> {
    const db = tx ?? this.db;
    const draw = await db.draw.findUnique({
      where: { id: drawId },
      select: {
        format: true,
        competitionId: true,
        categoryId: true,
        slots: { select: { position: true, entryId: true } },
      },
    });
    if (!draw) return null;
    const nodes = await db.bracketNode.findMany({
      where: { bracket: { drawId } },
      select: { id: true, key: true },
    });
    if (nodes.length === 0) return null;
    const strategy = requireStrategy(draw.format);
    const graph = strategy.build(draw.slots.length);
    const nodeIds = new Map(nodes.map((n) => [n.key, n.id]));
    const byNode = new Map(
      (await this.matches.byNodes(tx, [...nodeIds.values()])).map((m) => [m.bracketNodeId, m]),
    );
    const matchByKey = new Map<string, MatchRecord>();
    const outcomes = new Map<string, Outcome>();
    for (const [key, id] of nodeIds) {
      const m = byNode.get(id);
      if (!m) continue;
      matchByKey.set(key, m);
      // Способ победы хранит результат схватки (Phase 7); для продвижения достаточно победителя.
      if (isPlayed(m) && m.winnerSide) outcomes.set(key, { winner: m.winnerSide, method: 'POINTS' });
    }
    const state = resolveFormat(strategy, graph, slotMap(draw.slots), outcomes);
    return {
      graph,
      state,
      nodeIds,
      matchByKey,
      competitionId: draw.competitionId,
      categoryId: draw.categoryId,
    };
  }

  /** Узлы опубликованной сетки со схватками; сетки нет — null. */
  async view(drawId: string): Promise<BracketNodeDto[] | null> {
    const live = await this.live(null, drawId);
    return live ? nodeDtos(live.graph, live.state, (key) => live.matchByKey.get(key)) : null;
  }

  /** Движок продвижения: стороны и статусы схваток приводятся к состоянию сетки. Возвращает число изменений. */
  async propagate(tx: Tx, drawId: string): Promise<number> {
    const live = await this.live(tx, drawId);
    if (!live) return 0;
    const specs = live.graph.nodes.map((n) =>
      // Длительность задана при публикации; продвижение меняет только стороны и статусы.
      matchSpec(n, nodeState(live.state, n.key), live.nodeIds.get(n.key) as string, {
        main: null,
        repechage: null,
      }),
    );
    return this.matches.sync(tx, live.competitionId, specs);
  }

  /**
   * Подтверждённый результат схватки сетки (ARCHITECTURE.md, 16.6): победитель и продвижение — в одной транзакции.
   * Вызывает модуль схваток (Phase 7) после подтверждения результата уполномоченным лицом.
   */
  async applyConfirmedResult(tx: Tx, matchId: string, winnerSide: Side): Promise<number> {
    const match = await this.matches.markDecided(tx, matchId, winnerSide);
    if (!match.bracketNodeId) return 0;
    const node = await tx.bracketNode.findUniqueOrThrow({
      where: { id: match.bracketNodeId },
      select: { bracket: { select: { drawId: true } } },
    });
    const changed = await this.propagate(tx, node.bracket.drawId);
    await this.audit.record(tx, {
      action: 'bracket.advanced',
      entityType: 'Match',
      entityId: matchId,
      competitionId: match.competitionId,
      after: { winnerSide, changedMatches: changed },
    });
    return changed;
  }

  /** Сетка жеребьёвки удаляется при новой версии, если ни одна схватка не начата и не сыграна. */
  async removeForDraw(tx: Tx, drawId: string): Promise<void> {
    const ids = (await tx.bracketNode.findMany({ where: { bracket: { drawId } }, select: { id: true } })).map(
      (n) => n.id,
    );
    const started = await this.matches.startedAmong(tx, ids);
    if (started.length > 0)
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
        failed: ['matches_started'],
        matches: started.map((m) => m.matchNumber),
      });
    await this.matches.removeForNodes(tx, ids);
    await tx.bracketNode.deleteMany({ where: { bracket: { drawId } } });
    await tx.bracket.deleteMany({ where: { drawId } });
  }
}
