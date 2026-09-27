// Блокировки команд над категориями турнира: турнир — на чтение (его переход ждёт), категория — на запись.
import type { CompetitionStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import type { CategoryRow } from './category-mapper';

export const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

/** Турнир `FOR SHARE`: переход турнира (`FOR UPDATE`) ждёт завершения команд над категориями. */
export async function lockCompetitionShared(tx: Tx, competitionId: string): Promise<CompetitionStatus> {
  const rows = await tx.$queryRaw<{ status: CompetitionStatus }[]>`
    SELECT status FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR SHARE`;
  if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'competition' });
  return rows[0].status;
}

export async function lockCategory(
  tx: Tx,
  competitionId: string,
  categoryId: string,
  version?: number,
): Promise<CategoryRow> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM competition_category WHERE id = ${categoryId}::uuid AND competition_id = ${competitionId}::uuid FOR UPDATE`;
  if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'category' });
  const row = await tx.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } });
  if (version !== undefined && row.version !== version) throw versionConflict(row.version);
  return row;
}
