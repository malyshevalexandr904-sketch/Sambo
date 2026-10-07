// Сетки (ARCHITECTURE.md, 14.4; DATABASE.md, 3.6): граф опубликованной жеребьёвки, начальное состояние (BYE
// первого круга), схватки узлов, движок продвижения и удаление сетки при новой версии жеребьёвки.
// Состояние сетки не хранится отдельно: оно пересчитывается из жеребьёвки и сыгранных схваток, а стороны схваток
// приводятся к нему — так продвижение, BYE и утешительные схватки не расходятся с графом.
import { Injectable } from '@nestjs/common';
import type { BracketNodeDto, BracketStage, CompetitionFormatCode, DrawStatus } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import {
  type ConfirmedOutcome,
  isConfirmed,
  isPlayed,
  type MatchRecord,
  MatchesService,
} from '../../matches';
import { nodeDependencies, participantsKnownAtPublish } from '../domain/dependencies';
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

/** Зависимость и место схватки сетки в очереди категории — вход планировщика расписания (Phase 6, §2). */
export interface MatchDependency {
  matchId: string;
  /** Схватки, чей исход определяет участников этой схватки — id схваток (могут быть неполными, см. метод). */
  dependsOn: string[];
  /** Оба участника известны сразу по жеребьёвке (первый круг выбывания, круговая система). */
  participantsKnown: boolean;
  /** Порядок схватки внутри категории: круги основной сетки, утешительные схватки, затем финал (numberingOrder). */
  orderInCategory: number;
  /** Финал или схватка за 3-е место — переносится в конец дня при включённом блоке финалов. */
  isFinalsBlock: boolean;
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
      // Сетку продвигает только подтверждённый результат сыгранной схватки (Phase 7a): победитель (или никто —
      // неявка обоих), способ и счёт — для мест в круговой системе.
      if (isPlayed(m) && isConfirmed(m) && m.result)
        outcomes.set(key, {
          winner: m.result.winnerSide,
          method: m.result.method,
          redScore: m.result.redScore ?? undefined,
          blueScore: m.result.blueScore ?? undefined,
        });
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

  /**
   * Зависимости схваток сетки (Phase 6, §2): схватка не может стоять в расписании раньше схваток, от которых
   * зависят её участники. Узел без схватки (BYE, ещё не создана) в результат не попадает — такой ключ просто
   * выпадает из чужого dependsOn (nodeDependencies возвращает ключи узлов, которых здесь может не быть).
   */
  async matchDependencies(tx: Tx | null, drawId: string): Promise<Map<string, MatchDependency>> {
    const live = await this.live(tx, drawId);
    const result = new Map<string, MatchDependency>();
    if (!live) return result;
    const order = new Map(numberingOrder(live.graph).map((n, i) => [n.key, i]));
    for (const node of live.graph.nodes) {
      const match = live.matchByKey.get(node.key);
      if (!match) continue;
      const dependsOn = nodeDependencies(node, live.graph)
        .map((key) => live.matchByKey.get(key)?.id)
        .filter((id): id is string => id !== undefined);
      result.set(match.id, {
        matchId: match.id,
        dependsOn,
        participantsKnown: participantsKnownAtPublish(node),
        orderInCategory: order.get(node.key) ?? 0,
        isFinalsBlock: node.label === 'FINAL' || node.label === 'BRONZE',
      });
    }
    return result;
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
   * Жеребьёвка схватки сетки, заблокированная FOR UPDATE; жеребьёвка должна быть опубликована. Блокировка
   * упорядочивает продвижение по одной сетке (результаты на двух коврах не перезаписывают стороны друг друга)
   * и не даёт новой версии жеребьёвки удалить только что сыгранную схватку. Порядок блокировок — жеребьёвка,
   * затем схватка, как у новой версии жеребьёвки: вызывающий блокирует схватку только после этого вызова.
   * Схватка вне сетки — null.
   */
  async lockDrawOfMatch(tx: Tx, matchId: string): Promise<string | null> {
    const [row] = await tx.$queryRaw<{ id: string; status: DrawStatus }[]>`
      SELECT d.id, d.status::text AS status
        FROM "match" m
        JOIN "bracket_node" n ON n.id = m.bracket_node_id
        JOIN "bracket" b ON b.id = n.bracket_id
        JOIN "draw" d ON d.id = b.draw_id
       WHERE m.id = ${matchId}::uuid
         FOR UPDATE OF d`;
    if (!row) return null;
    if (row.status !== 'PUBLISHED')
      throw new DomainError('INVALID_TRANSITION', { from: row.status, to: 'FINISHED', allowed: [] });
    return row.id;
  }

  /** Опубликованная жеребьёвка FOR UPDATE (снятие участника: неявки по сетке под той же блокировкой). */
  async lockDraw(tx: Tx, drawId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ status: DrawStatus }[]>`
      SELECT status::text AS status FROM "draw" WHERE id = ${drawId}::uuid FOR UPDATE`;
    return row?.status === 'PUBLISHED';
  }

  /**
   * Продвижение после подтверждённого результата схватки `matchId` (ARCHITECTURE.md, 16.6): стороны зависимых
   * схваток приводятся к состоянию сетки, аудит `bracket.advanced`. Вызывается под блокировкой lockDrawOfMatch.
   */
  async advance(tx: Tx, drawId: string, matchId: string, competitionId: string): Promise<number> {
    const changed = await this.propagate(tx, drawId);
    await this.audit.record(tx, {
      action: 'bracket.advanced',
      entityType: 'Match',
      entityId: matchId,
      competitionId,
      after: { changedMatches: changed },
    });
    return changed;
  }

  /** Узлы опубликованной сетки жеребьёвки (id) — для поиска схваток сетки. */
  async nodeIdsOfDraw(tx: Tx | null, drawId: string): Promise<string[]> {
    const rows = await (tx ?? this.db).bracketNode.findMany({
      where: { bracket: { drawId } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Опубликованная жеребьёвка категории (id) или null — сетки нет. */
  async publishedDrawOfCategory(tx: Tx | null, categoryId: string): Promise<string | null> {
    const row = await (tx ?? this.db).draw.findFirst({
      where: { categoryId, status: 'PUBLISHED' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Подтверждённый исход без бригады ковра (система и тесты движка): победитель и продвижение — в одной транзакции.
   * Судейство (Phase 7a) подтверждает предварительный результат своей командой: lockDrawOfMatch → схватка →
   * advance — в том же порядке блокировок.
   */
  async applyConfirmedResult(
    tx: Tx,
    matchId: string,
    outcome: ConfirmedOutcome,
    confirmedById: string | null = null,
  ): Promise<number> {
    const drawId = await this.lockDrawOfMatch(tx, matchId);
    const match = await this.matches.recordConfirmedOutcome(tx, matchId, outcome, confirmedById);
    return drawId ? this.advance(tx, drawId, matchId, match.competitionId) : 0;
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
