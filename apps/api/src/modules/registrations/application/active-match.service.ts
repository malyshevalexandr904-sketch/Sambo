// «Спортсмен на ковре» (DATABASE.md, 4; план Phase 7a, §1): условный UPDATE `entry.active_match_id` при старте
// схватки — второй ковёр не стартует схватку с тем же спортсменом (ATHLETE_IN_ACTIVE_MATCH), в том числе по его
// участию в другой категории турнира; снимается при предварительном результате. Участие — таблица модуля заявок;
// модуль судейства вызывает этот сервис.
import { Injectable } from '@nestjs/common';
import type { AdmissionStatus, EntryStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { lockAthleteInCompetition } from './entry-commands';

export interface EntryReadiness {
  entryId: string;
  status: EntryStatus;
  admission: AdmissionStatus | null;
  /** Идущая схватка этого спортсмена в турнире (по любому его участию) или null. */
  activeMatchId: string | null;
}

@Injectable()
export class ActiveMatchService {
  constructor(private readonly db: PrismaService) {}

  /** Готовность участников к схватке: статус участия, допуск, занят ли спортсмен в другой схватке турнира. */
  async readiness(tx: Tx | null, entryIds: readonly string[]): Promise<EntryReadiness[]> {
    if (entryIds.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db.entry.findMany({
      where: { id: { in: [...entryIds] } },
      select: {
        id: true,
        athleteId: true,
        competitionId: true,
        status: true,
        admission: { select: { status: true } },
      },
    });
    const busy = await db.entry.findMany({
      where: {
        athleteId: { in: rows.map((r) => r.athleteId) },
        competitionId: { in: [...new Set(rows.map((r) => r.competitionId))] },
        activeMatchId: { not: null },
      },
      select: { athleteId: true, competitionId: true, activeMatchId: true },
    });
    return rows.map((r) => ({
      entryId: r.id,
      status: r.status,
      admission: r.admission?.status ?? null,
      activeMatchId:
        busy.find((b) => b.athleteId === r.athleteId && b.competitionId === r.competitionId)?.activeMatchId ??
        null,
    }));
  }

  /**
   * Оба участника — «на ковре» в схватке `matchId`: участие одобрено, спортсмен не занят другой схваткой турнира.
   * Проверка по всем участиям спортсмена идёт под advisory-блокировкой спортсмена в турнире (тот же ключ, что у
   * команд заявок), затем — условное обновление участия. Спортсмены блокируются по порядку — параллельные старты
   * с общим спортсменом не встают во взаимную блокировку. Не прошло — ATHLETE_IN_ACTIVE_MATCH, откат целиком.
   */
  async claim(tx: Tx, matchId: string, entryIds: readonly string[]): Promise<void> {
    const rows = await tx.entry.findMany({
      where: { id: { in: [...entryIds] } },
      select: { id: true, athleteId: true, competitionId: true },
      orderBy: { athleteId: 'asc' },
    });
    for (const r of rows) await lockAthleteInCompetition(tx, r.competitionId, r.athleteId);
    for (const r of rows) {
      const other = await tx.entry.findFirst({
        where: {
          athleteId: r.athleteId,
          competitionId: r.competitionId,
          activeMatchId: { not: null },
          NOT: { activeMatchId: matchId },
        },
        select: { activeMatchId: true },
      });
      if (other)
        throw new DomainError('ATHLETE_IN_ACTIVE_MATCH', { entryId: r.id, matchId: other.activeMatchId });
      const updated = await tx.$executeRaw`
        UPDATE "entry" SET active_match_id = ${matchId}::uuid, updated_at = now()
         WHERE id = ${r.id}::uuid AND status = 'APPROVED'
           AND (active_match_id IS NULL OR active_match_id = ${matchId}::uuid)`;
      if (updated === 0) {
        const row = await tx.entry.findUnique({
          where: { id: r.id },
          select: { status: true, activeMatchId: true },
        });
        if (row && row.status !== 'APPROVED')
          throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['participant_withdrawn'] });
        throw new DomainError('ATHLETE_IN_ACTIVE_MATCH', {
          entryId: r.id,
          matchId: row?.activeMatchId ?? null,
        });
      }
    }
  }

  /** Участники схватки свободны (предварительный результат). */
  async release(tx: Tx, matchId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "entry" SET active_match_id = NULL, updated_at = now() WHERE active_match_id = ${matchId}::uuid`;
  }
}
