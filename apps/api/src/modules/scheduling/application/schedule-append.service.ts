// Схватка, добавленная вне сетки (Phase 7b, ручная схватка): место в конце ковра сессии — порядок после последней
// схватки ковра, плановое время — после её окончания со сменой пары (пустой ковёр — начало сессии). Строка
// расписания блокируется, как при правке; опубликованное расписание — событие изменения для клубов участников.
import { Injectable } from '@nestjs/common';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { OutboxService } from '../../outbox';
import { lockOrCreateSchedule } from './schedule-locks';

export interface AppendInput {
  competitionId: string;
  matchId: string;
  sessionId: string;
  matId: string;
}

@Injectable()
export class ScheduleAppendService {
  constructor(private readonly outbox: OutboxService) {}

  async append(tx: Tx, input: AppendInput): Promise<{ plannedAt: Date; orderInMat: number }> {
    const schedule = await lockOrCreateSchedule(tx, input.competitionId, null);
    const [session, mat] = await Promise.all([
      tx.session.findUnique({ where: { id: input.sessionId } }),
      tx.mat.findUnique({ where: { id: input.matId } }),
    ]);
    if (!session || session.competitionId !== input.competitionId)
      throw new DomainError('NOT_FOUND', { resource: 'session' });
    if (!mat || mat.competitionId !== input.competitionId)
      throw new DomainError('NOT_FOUND', { resource: 'mat' });
    const items = await tx.matchSchedule.findMany({
      where: { sessionId: session.id, matId: mat.id },
      select: { orderInMat: true, plannedAt: true, match: { select: { durationSeconds: true } } },
    });
    const changeover = schedule.matChangeoverSeconds * 1000;
    const orderInMat = items.reduce((max, i) => Math.max(max, i.orderInMat), 0) + 1;
    const ends = items.map((i) => i.plannedAt.getTime() + (i.match.durationSeconds ?? 0) * 1000 + changeover);
    const plannedAt = new Date(Math.max(session.startsAt.getTime(), ...ends));
    await tx.matchSchedule.create({
      data: {
        id: uuidv7(),
        competitionId: input.competitionId,
        matchId: input.matchId,
        sessionId: session.id,
        matId: mat.id,
        orderInMat,
        plannedAt,
      },
    });
    await tx.schedule.update({ where: { id: schedule.id }, data: { version: { increment: 1 } } });
    if (schedule.status === 'PUBLISHED')
      await this.outbox.enqueue(tx, {
        type: 'schedule.changed',
        aggregate: { type: 'Schedule', id: input.competitionId },
        competitionId: input.competitionId,
        payload: { competitionId: input.competitionId, matchIds: [input.matchId] },
      });
    return { plannedAt, orderInMat };
  }
}
