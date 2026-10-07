// Схватки сеток (DATABASE.md, 3.6): модуль — владелец таблиц match, match_participant, match_event и match_result.
// Phase 5a создаёт схватки при публикации жеребьёвки, заполняет стороны при продвижении по сетке и удаляет
// несыгранные схватки при новой версии жеребьёвки. Phase 7a: схватка, решённая без соперника, получает результат
// «без соперника» (BYE), подтверждённый системой; состояние, журнал и результат схватки — MatchStoreService.
import { Injectable } from '@nestjs/common';
import type { MatchStatus, Side, WinMethod } from '@sde/contracts';
import { type Prisma, publicId, type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { isStartedOrPlayed, MATCH_INCLUDE, type MatchRecord, sideOf } from './match-record';

export interface SideInit {
  entryId: string | null;
  bye: boolean;
}

/** Схватка узла сетки: стороны и то, как узел решён без схватки (соперника нет — WALKOVER, никого — EMPTY). */
export interface MatchSpec {
  bracketNodeId: string;
  roundLabel: string;
  durationSeconds: number | null;
  red: SideInit;
  blue: SideInit;
  resolution: 'OPEN' | 'WALKOVER' | 'EMPTY';
  winnerSide: Side | null;
}

/** Подтверждённый исход схватки сетки (движок продвижения: BracketsService.applyConfirmedResult). */
export interface ConfirmedOutcome {
  /** Пусто — неявка обоих: оба проигравшие. */
  winnerSide: Side | null;
  method: WinMethod;
  methodDetail?: string | null;
  redScore?: number | null;
  blueScore?: number | null;
}

const statusFor = (spec: MatchSpec): MatchStatus =>
  spec.resolution === 'WALKOVER' ? 'FINISHED' : spec.resolution === 'EMPTY' ? 'CANCELLED' : 'SCHEDULED';

/** Результат «без соперника» (BYE), подтверждённый системой. */
const byeResult = (
  competitionId: string,
  matchId: string,
  winnerSide: Side | null,
  at: Date,
): Prisma.MatchResultCreateManyInput => ({
  id: uuidv7(),
  competitionId,
  matchId,
  status: 'CONFIRMED',
  winnerSide,
  method: 'BYE',
  confirmedAt: at,
});

@Injectable()
export class MatchesService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Следующий номер схватки турнира. Номера сквозные; параллельные публикации одного турнира идут по очереди
   * (advisory-блокировка на время транзакции).
   */
  private async nextNumber(tx: Tx, competitionId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`match_number:${competitionId}`}, 0))`;
    const last = await tx.match.aggregate({ where: { competitionId }, _max: { matchNumber: true } });
    return (last._max.matchNumber ?? 0) + 1;
  }

  /** Схватки узлов сетки в порядке нумерации; схватки, уже решённые без соперника (BYE), номера не получают. */
  async createForBracket(
    tx: Tx,
    competitionId: string,
    categoryId: string,
    specs: MatchSpec[],
  ): Promise<void> {
    let next = await this.nextNumber(tx, competitionId);
    const now = new Date();
    const matches: Prisma.MatchCreateManyInput[] = [];
    const sides: Prisma.MatchParticipantCreateManyInput[] = [];
    const results: Prisma.MatchResultCreateManyInput[] = [];
    for (const spec of specs) {
      const id = uuidv7();
      const status = statusFor(spec);
      matches.push({
        id,
        competitionId,
        categoryId,
        bracketNodeId: spec.bracketNodeId,
        publicId: publicId(),
        matchNumber: spec.resolution === 'OPEN' ? next++ : null,
        roundLabel: spec.roundLabel,
        status,
        durationSeconds: spec.durationSeconds,
        winnerSide: spec.resolution === 'WALKOVER' ? spec.winnerSide : null,
        finishedAt: status === 'FINISHED' ? now : null,
      });
      if (spec.resolution === 'WALKOVER') results.push(byeResult(competitionId, id, spec.winnerSide, now));
      for (const side of ['RED', 'BLUE'] as const) {
        const s = side === 'RED' ? spec.red : spec.blue;
        sides.push({ id: uuidv7(), competitionId, matchId: id, side, entryId: s.entryId, isBye: s.bye });
      }
    }
    await tx.match.createMany({ data: matches });
    await tx.matchParticipant.createMany({ data: sides });
    if (results.length > 0) await tx.matchResult.createMany({ data: results });
  }

  async byNodes(tx: Tx | null, bracketNodeIds: string[]): Promise<MatchRecord[]> {
    if (bracketNodeIds.length === 0) return [];
    return (tx ?? this.db).match.findMany({
      where: { bracketNodeId: { in: bracketNodeIds } },
      include: MATCH_INCLUDE,
    });
  }

  /** Схватки категории (Phase 6: вход планировщика расписания собирается по категориям опубликованных сеток). */
  async byCategory(tx: Tx | null, categoryId: string): Promise<MatchRecord[]> {
    return (tx ?? this.db).match.findMany({ where: { categoryId }, include: MATCH_INCLUDE });
  }

  /** Одна схватка со сторонами; не найдена — null. */
  async byId(tx: Tx | null, matchId: string): Promise<MatchRecord | null> {
    return (tx ?? this.db).match.findUnique({ where: { id: matchId }, include: MATCH_INCLUDE });
  }

  /**
   * Подтверждённый исход, записанный без бригады ковра (движок продвижения и его тесты; система): схватка
   * завершается, результат — подтверждённый. Вызывается под блокировкой жеребьёвки (BracketsService).
   */
  async recordConfirmedOutcome(
    tx: Tx,
    matchId: string,
    outcome: ConfirmedOutcome,
    confirmedById: string | null,
  ): Promise<MatchRecord> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "match" WHERE id = ${matchId}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'match' });
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: MATCH_INCLUDE });
    if (match.participants.some((p) => p.entryId === null))
      throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId });
    if (match.status === 'FINISHED' || match.status === 'CANCELLED')
      throw new DomainError('INVALID_TRANSITION', { from: match.status, to: 'FINISHED', allowed: [] });
    const now = new Date();
    await tx.matchResult.create({
      data: {
        id: uuidv7(),
        competitionId: match.competitionId,
        matchId,
        status: 'CONFIRMED',
        winnerSide: outcome.winnerSide,
        method: outcome.method,
        methodDetail: outcome.methodDetail ?? null,
        redScore: outcome.redScore ?? null,
        blueScore: outcome.blueScore ?? null,
        proposedById: confirmedById,
        proposedAt: now,
        confirmedById,
        confirmedAt: now,
      },
    });
    return tx.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        winnerSide: outcome.winnerSide,
        finishedAt: now,
        version: { increment: 1 },
      },
      include: MATCH_INCLUDE,
    });
  }

  /**
   * Приведение сторон и статуса схваток к состоянию сетки после продвижения. Схватку, которая уже идёт или сыграна,
   * менять нельзя: DEPENDENT_MATCHES_STARTED (изменение результата, от которого она зависит, — Phase 7b).
   */
  async sync(tx: Tx, competitionId: string, specs: MatchSpec[]): Promise<number> {
    const current = new Map(
      (
        await this.byNodes(
          tx,
          specs.map((s) => s.bracketNodeId),
        )
      ).map((m) => [m.bracketNodeId, m]),
    );
    let changed = 0;
    for (const spec of specs) {
      const match = current.get(spec.bracketNodeId);
      if (!match || !this.differs(match, spec)) continue;
      if (isStartedOrPlayed(match))
        throw new DomainError('DEPENDENT_MATCHES_STARTED', {
          matchId: match.id,
          matchNumber: match.matchNumber,
        });
      await this.apply(tx, competitionId, match, spec);
      changed += 1;
    }
    return changed;
  }

  private differs(m: MatchRecord, spec: MatchSpec): boolean {
    const same = (side: Side, s: SideInit): boolean => {
      const p = sideOf(m, side);
      return (p?.entryId ?? null) === s.entryId && (p?.isBye ?? false) === s.bye;
    };
    if (!same('RED', spec.red) || !same('BLUE', spec.blue)) return true;
    // Идущая или сыгранная схватка с теми же сторонами состоянию сетки соответствует.
    if (isStartedOrPlayed(m)) return false;
    // Вызванная схватка (READY) — та же несыгранная схватка, продвижение её не сбрасывает.
    const have = m.status === 'READY' ? 'SCHEDULED' : m.status;
    if (have !== statusFor(spec)) return true;
    const winner = spec.resolution === 'WALKOVER' ? spec.winnerSide : null;
    return m.status === 'FINISHED' && m.winnerSide !== winner;
  }

  private async apply(tx: Tx, competitionId: string, m: MatchRecord, spec: MatchSpec): Promise<void> {
    for (const side of ['RED', 'BLUE'] as const) {
      const s = side === 'RED' ? spec.red : spec.blue;
      await tx.matchParticipant.update({
        where: { matchId_side: { matchId: m.id, side } },
        data: { entryId: s.entryId, isBye: s.bye },
      });
    }
    const status = statusFor(spec);
    // Номер, выданный при публикации, не меняется: по нему работают печатная сетка и расписание. Схватка,
    // оставшаяся без соперника, сохраняет номер (в сетке — «без схватки»); номер получает только схватка,
    // которая была без соперника с публикации и стала настоящей.
    const matchNumber =
      m.matchNumber ?? (status === 'SCHEDULED' ? await this.nextNumber(tx, competitionId) : null);
    const winnerSide = spec.resolution === 'WALKOVER' ? spec.winnerSide : null;
    const now = new Date();
    // Результат «без соперника» следует за состоянием узла: появился у решённой без соперника схватки, исчез — если
    // она снова ждёт соперника (изменение результата раньше по сетке, Phase 7b).
    if (m.result?.method === 'BYE') await tx.matchResult.delete({ where: { matchId: m.id } });
    if (status === 'FINISHED')
      await tx.matchResult.create({ data: byeResult(competitionId, m.id, winnerSide, now) });
    await tx.match.update({
      where: { id: m.id },
      data: {
        status,
        winnerSide,
        finishedAt: status === 'FINISHED' ? now : null,
        readyAt: null,
        matchNumber,
        version: { increment: 1 },
      },
    });
  }

  /** Схватки узлов, которые начались или сыграны: при них новая версия жеребьёвки запрещена. */
  async startedAmong(tx: Tx, bracketNodeIds: string[]): Promise<MatchRecord[]> {
    return (await this.byNodes(tx, bracketNodeIds)).filter(isStartedOrPlayed);
  }

  /**
   * Удаление схваток узлов (новая версия жеребьёвки): только несыгранные — проверяет вызывающий. Результаты
   * «без соперника» удаляются вместе со схватками; журнала событий у несыгранной схватки нет.
   */
  async removeForNodes(tx: Tx, bracketNodeIds: string[]): Promise<void> {
    if (bracketNodeIds.length === 0) return;
    const where = { match: { bracketNodeId: { in: bracketNodeIds } } };
    await tx.matchResult.deleteMany({ where });
    await tx.matchParticipant.deleteMany({ where });
    await tx.match.deleteMany({ where: { bracketNodeId: { in: bracketNodeIds } } });
  }
}
