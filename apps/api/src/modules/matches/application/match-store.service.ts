// Состояние, журнал и результат схватки (Phase 7a; DATABASE.md, 3.6): хранение агрегата схватки для команд модуля
// судейства. Правила (кто, когда, по какому счёту) проверяет вызывающий; здесь — запись под блокировкой строки
// схватки и проверка версии (If-Match). Журнал событий только дополняется (у роли приложения нет UPDATE/DELETE).
import { Injectable } from '@nestjs/common';
import type { MatchState, Side, WinMethod } from '@sde/contracts';
import { type MatchEvent, Prisma, type Tx, uuidv7 } from '@sde/db';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MATCH_INCLUDE, type MatchRecord } from './match-record';

export interface EventWrite {
  id: string;
  type: MatchEvent['type'];
  side: Side | null;
  actionCode: string | null;
  value: number | null;
  matchClockMs: number;
  deviceTime: Date;
  voidsEventId: string | null;
  idempotencyKey: string;
  recordedById: string;
  deviceId: string | null;
  payload: Prisma.InputJsonValue | null;
}

export interface ProvisionalWrite {
  winnerSide: Side | null;
  method: WinMethod;
  methodDetail: string | null;
  redScore: number | null;
  blueScore: number | null;
  durationMs: number | null;
  basedOnSeq: number | null;
  reason: string | null;
  proposedById: string;
}

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const asJson = (state: MatchState): Prisma.InputJsonValue => state as unknown as Prisma.InputJsonValue;

@Injectable()
export class MatchStoreService {
  constructor(private readonly db: PrismaService) {}

  /** Схватка FOR UPDATE со сторонами и результатом; `version` — ожидаемая версия (If-Match). */
  async lock(tx: Tx, matchId: string, version?: number): Promise<MatchRecord> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "match" WHERE id = ${matchId}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'match' });
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: MATCH_INCLUDE });
    if (version !== undefined && match.version !== version) throw versionConflict(match.version);
    return match;
  }

  private bump(tx: Tx, m: MatchRecord, data: Prisma.MatchUpdateInput): Promise<MatchRecord> {
    return tx.match.update({
      where: { id: m.id },
      data: { ...data, version: { increment: 1 } },
      include: MATCH_INCLUDE,
    });
  }

  /** Вызов пары на ковёр. */
  markReady(tx: Tx, m: MatchRecord): Promise<MatchRecord> {
    return this.bump(tx, m, { status: 'READY', readyAt: new Date() });
  }

  /** Отмена вызова. */
  cancelReady(tx: Tx, m: MatchRecord): Promise<MatchRecord> {
    return this.bump(tx, m, { status: 'SCHEDULED', readyAt: null });
  }

  /** Старт: фактический ковёр, время старта, начальная проекция счёта. */
  markStarted(tx: Tx, m: MatchRecord, matId: string, state: MatchState): Promise<MatchRecord> {
    return this.bump(tx, m, {
      status: 'IN_PROGRESS',
      mat: { connect: { id: matId } },
      startedAt: m.startedAt ?? new Date(),
      state: m.state ?? asJson(state),
    });
  }

  /** Длинная остановка (врач, экипировка) и продолжение. */
  setPaused(tx: Tx, m: MatchRecord, paused: boolean): Promise<MatchRecord> {
    return this.bump(tx, m, { status: paused ? 'PAUSED' : 'IN_PROGRESS' });
  }

  /** Журнал схватки по порядку; `afterSeq` — только события после этого номера. */
  events(tx: Tx | null, matchId: string, afterSeq = 0): Promise<MatchEvent[]> {
    return (tx ?? this.db).matchEvent.findMany({
      where: { matchId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
    });
  }

  /** Событие, уже записанное по этому ключу идемпотентности (повтор команды). */
  eventByKey(tx: Tx, matchId: string, idempotencyKey: string): Promise<MatchEvent | null> {
    return tx.matchEvent.findUnique({ where: { matchId_idempotencyKey: { matchId, idempotencyKey } } });
  }

  /**
   * Новое событие журнала с номером `stateSeq + 1` и новая проекция счёта. Версию схватки не меняет: порядок
   * событий защищают expectedSeq и unique (matchId, seq), повтор — unique (matchId, idempotencyKey).
   */
  async appendEvent(tx: Tx, m: MatchRecord, write: EventWrite, state: MatchState): Promise<MatchEvent> {
    const seq = m.stateSeq + 1;
    try {
      const event = await tx.matchEvent.create({
        data: {
          competitionId: m.competitionId,
          matchId: m.id,
          seq,
          ...write,
          payload: write.payload ?? Prisma.DbNull,
        },
      });
      await tx.match.update({
        where: { id: m.id },
        data: { state: asJson({ ...state, seq }), stateSeq: seq },
      });
      return event;
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError('EXPECTED_SEQ_MISMATCH', { currentSeq: m.stateSeq });
      throw e;
    }
  }

  /**
   * Предварительный результат и завершение схватки. Повторный ввод до подтверждения заменяет предварительный
   * результат (бригада исправляет ошибку); время завершения — первое.
   */
  async finishProvisional(tx: Tx, m: MatchRecord, write: ProvisionalWrite): Promise<MatchRecord> {
    const now = new Date();
    const data = { ...write, status: 'PROVISIONAL' as const, proposedAt: now };
    await tx.matchResult.upsert({
      where: { matchId: m.id },
      create: { id: uuidv7(), competitionId: m.competitionId, matchId: m.id, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    return this.bump(tx, m, { status: 'FINISHED', finishedAt: m.finishedAt ?? now, winnerSide: null });
  }

  /** Подтверждение предварительного результата: победитель записывается в схватку (сетку продвигает вызывающий). */
  async confirm(tx: Tx, m: MatchRecord, confirmedById: string): Promise<MatchRecord> {
    const result = m.result;
    if (!result) throw new DomainError('MATCH_RESULT_INCOMPLETE', { matchId: m.id });
    await tx.matchResult.update({
      where: { matchId: m.id },
      data: { status: 'CONFIRMED', confirmedById, confirmedAt: new Date(), version: { increment: 1 } },
    });
    return this.bump(tx, m, { winnerSide: result.winnerSide });
  }

  /**
   * Неявка снятого после жеребьёвки участника — исход без судьи, подтверждённый системой: победитель — оставшийся
   * участник (оба сняты — победителя нет, оба проигравшие).
   */
  async systemNoShow(tx: Tx, m: MatchRecord, winnerSide: Side | null, reason: string): Promise<MatchRecord> {
    const now = new Date();
    await tx.matchResult.create({
      data: {
        id: uuidv7(),
        competitionId: m.competitionId,
        matchId: m.id,
        status: 'CONFIRMED',
        winnerSide,
        method: 'NO_SHOW',
        reason,
        confirmedAt: now,
      },
    });
    return this.bump(tx, m, { status: 'FINISHED', finishedAt: now, readyAt: null, winnerSide });
  }

  /**
   * Несыгранные схватки узлов (не начаты), где оба участника известны и хотя бы один снят после жеребьёвки:
   * кандидаты на неявку без судьи (план Phase 7a, §3).
   */
  async unstartedWithWithdrawn(tx: Tx, bracketNodeIds: readonly string[]): Promise<MatchRecord[]> {
    if (bracketNodeIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id
        FROM "match" m
       WHERE m.bracket_node_id = ANY(${[...bracketNodeIds]}::uuid[])
         AND m.status IN ('SCHEDULED', 'READY')
         AND NOT EXISTS (SELECT 1 FROM "match_participant" p WHERE p.match_id = m.id AND p.entry_id IS NULL)
         AND EXISTS (SELECT 1 FROM "match_participant" p JOIN "entry" e ON e.id = p.entry_id
                      WHERE p.match_id = m.id AND e.status = 'WITHDRAWN')
       ORDER BY m.match_number NULLS LAST, m.id`;
    if (rows.length === 0) return [];
    return tx.match.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: MATCH_INCLUDE });
  }
}
