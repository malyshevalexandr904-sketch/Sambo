// Блокировки команд расписания: турнир — на чтение (его переход DRAWING→SCHEDULED ждёт), строка расписания —
// на запись. Строка расписания создаётся лениво при первом обращении к разделу (одна на турнир).
import type { CompetitionStatus } from '@sde/contracts';
import { type Schedule, type Tx, uuidv7 } from '@sde/db';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';

export async function lockCompetitionShared(tx: Tx, competitionId: string): Promise<CompetitionStatus> {
  const rows = await tx.$queryRaw<{ status: CompetitionStatus }[]>`
    SELECT status FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR SHARE`;
  if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'competition' });
  return rows[0].status;
}

/**
 * Строка расписания турнира FOR UPDATE; создаётся при первом обращении (DRAFT, смена пары по умолчанию —
 * ON CONFLICT DO NOTHING делает создание идемпотентным при параллельном первом запросе). `version` — ожидаемая
 * версия (If-Match); не передан — блокировка без проверки версии (генерация не требует If-Match самого расписания
 * отдельно от его содержимого, публикация и правка — требуют).
 */
export async function lockOrCreateSchedule(
  tx: Tx,
  competitionId: string,
  version: number | null,
): Promise<Schedule> {
  await tx.$executeRaw`
    INSERT INTO schedule (id, competition_id, updated_at) VALUES (${uuidv7()}::uuid, ${competitionId}::uuid, now())
    ON CONFLICT (competition_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM schedule WHERE competition_id = ${competitionId}::uuid FOR UPDATE`;
  const id = rows[0]?.id;
  if (!id) throw new DomainError('NOT_FOUND', { resource: 'schedule' });
  const row = await tx.schedule.findUniqueOrThrow({ where: { id } });
  if (version !== null && row.version !== version) throw versionConflict(row.version);
  return row;
}
