// Схватки сеток (DATABASE.md, 3.6): модуль — владелец таблиц match и match_participant. Phase 5a создаёт схватки
// при публикации жеребьёвки, заполняет стороны при продвижении по сетке и удаляет несыгранные схватки при новой
// версии жеребьёвки. Машина состояний схватки, счёт и результат — Phase 7.
import { Injectable } from '@nestjs/common';
import type { MatchStatus, Side } from '@sde/contracts';
import { type Prisma, publicId, type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

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

const MATCH_INCLUDE = { participants: true } satisfies Prisma.MatchInclude;
export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof MATCH_INCLUDE }>;

/** Схватка началась или сыграна: её стороны больше не меняются продвижением по сетке. */
const STARTED: readonly MatchStatus[] = ['IN_PROGRESS', 'PAUSED'];

export const sideOf = (m: MatchRecord, side: Side) => m.participants.find((p) => p.side === side);

/** Сыграна (а не завершена системой без соперника). */
export const isPlayed = (m: MatchRecord): boolean =>
  m.status === 'FINISHED' && m.participants.length === 2 && m.participants.every((p) => p.entryId !== null);

export const isStartedOrPlayed = (m: MatchRecord): boolean => STARTED.includes(m.status) || isPlayed(m);

const statusFor = (spec: MatchSpec): MatchStatus =>
  spec.resolution === 'WALKOVER' ? 'FINISHED' : spec.resolution === 'EMPTY' ? 'CANCELLED' : 'SCHEDULED';

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
      for (const side of ['RED', 'BLUE'] as const) {
        const s = side === 'RED' ? spec.red : spec.blue;
        sides.push({ id: uuidv7(), competitionId, matchId: id, side, entryId: s.entryId, isBye: s.bye });
      }
    }
    await tx.match.createMany({ data: matches });
    await tx.matchParticipant.createMany({ data: sides });
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

  /** Сыгранная схватка: победитель (подтверждённый результат — Phase 7). */
  async markDecided(tx: Tx, matchId: string, winnerSide: Side): Promise<MatchRecord> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "match" WHERE id = ${matchId}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'match' });
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: MATCH_INCLUDE });
    if (match.participants.some((p) => p.entryId === null))
      throw new DomainError('MATCH_PARTICIPANTS_INCOMPLETE', { matchId });
    if (match.status === 'FINISHED' || match.status === 'CANCELLED')
      throw new DomainError('INVALID_TRANSITION', { from: match.status, to: 'FINISHED', allowed: [] });
    return tx.match.update({
      where: { id: matchId },
      data: { status: 'FINISHED', winnerSide, finishedAt: new Date(), version: { increment: 1 } },
      include: MATCH_INCLUDE,
    });
  }

  /**
   * Приведение сторон и статуса схваток к состоянию сетки после продвижения. Схватку, которая уже идёт или сыграна,
   * менять нельзя: DEPENDENT_MATCHES_STARTED (изменение результата, от которого она зависит, — Phase 7).
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
    const winner = spec.resolution === 'WALKOVER' ? spec.winnerSide : null;
    if (m.status === 'FINISHED' && isPlayed(m)) return !same('RED', spec.red) || !same('BLUE', spec.blue);
    return (
      !same('RED', spec.red) ||
      !same('BLUE', spec.blue) ||
      m.status !== statusFor(spec) ||
      (m.status === 'FINISHED' && m.winnerSide !== winner)
    );
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
    await tx.match.update({
      where: { id: m.id },
      data: {
        status,
        winnerSide: spec.resolution === 'WALKOVER' ? spec.winnerSide : null,
        finishedAt: status === 'FINISHED' ? new Date() : null,
        matchNumber,
        version: { increment: 1 },
      },
    });
  }

  /** Схватки узлов, которые начались или сыграны: при них новая версия жеребьёвки запрещена. */
  async startedAmong(tx: Tx, bracketNodeIds: string[]): Promise<MatchRecord[]> {
    return (await this.byNodes(tx, bracketNodeIds)).filter(isStartedOrPlayed);
  }

  /** Удаление схваток узлов (новая версия жеребьёвки): только несыгранные — проверяет вызывающий. */
  async removeForNodes(tx: Tx, bracketNodeIds: string[]): Promise<void> {
    if (bracketNodeIds.length === 0) return;
    await tx.matchParticipant.deleteMany({ where: { match: { bracketNodeId: { in: bracketNodeIds } } } });
    await tx.match.deleteMany({ where: { bracketNodeId: { in: bracketNodeIds } } });
  }
}
