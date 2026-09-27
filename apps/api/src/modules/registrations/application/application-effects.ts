// Заявка и её участия: выборки и счётчики, события outbox и последствия переходов заявки для участий.
import type { ApplicationStatus } from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import { RequestContextStore } from '../../../common/context/request-context';
import type { decodeCursor } from '../../../common/http/http';
import type { OutboxService } from '../../outbox';
import { ACTIVE_ENTRY_STATUSES } from '../domain/entry-rules';
import { EMPTY_COUNTS, type EntryCounts } from './registration-mapper';

/** Действующий период членства: без даты окончания или она ещё не прошла. */
export const currentPeriod = () => ({
  OR: [{ validTo: null }, { validTo: { gte: new Date(new Date().toISOString().slice(0, 10)) } }],
});

/** Курсор списка заявок: по времени изменения, затем по id (новые сверху). */
export function applicationCursorWhere(
  cursor: ReturnType<typeof decodeCursor>,
): Prisma.ApplicationWhereInput {
  if (!cursor) return {};
  const at = new Date(cursor.k);
  return { OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: cursor.id } }] };
}

/** Число участий заявок по статусам (действующие — ждут решения и одобренные). */
export async function entryCounts(db: Tx, ids: string[]): Promise<Map<string, EntryCounts>> {
  if (ids.length === 0) return new Map();
  const groups = await db.entry.groupBy({
    by: ['applicationId', 'status'],
    where: { applicationId: { in: ids } },
    _count: { _all: true },
  });
  const result = new Map<string, EntryCounts>();
  for (const g of groups) {
    const c = { ...(result.get(g.applicationId) ?? EMPTY_COUNTS) };
    const n = g._count._all;
    if (g.status === 'PENDING') c.pending += n;
    if (g.status === 'APPROVED') c.approved += n;
    if (g.status === 'REJECTED') c.rejected += n;
    if (g.status === 'WITHDRAWN') c.withdrawn += n;
    if (g.status === 'PENDING' || g.status === 'APPROVED') c.entries += n;
    result.set(g.applicationId, c);
  }
  return result;
}

/** События заявки в outbox: подана, возвращена на исправление, решение. */
export async function applicationEvents(
  outbox: OutboxService,
  tx: Tx,
  id: string,
  competitionId: string,
  to: string,
): Promise<void> {
  const aggregate = { type: 'Application', id };
  if (to === 'SUBMITTED')
    await outbox.enqueue(tx, {
      type: 'registration.application_submitted',
      aggregate,
      competitionId,
      payload: { applicationId: id },
    });
  if (to === 'WAITING_DOCUMENTS')
    await outbox.enqueue(tx, {
      type: 'registration.application_returned',
      aggregate,
      competitionId,
      payload: { applicationId: id },
    });
  if (to === 'APPROVED' || to === 'REJECTED')
    await outbox.enqueue(tx, {
      type: 'registration.application_decided',
      aggregate,
      competitionId,
      payload: { applicationId: id, status: to },
    });
}

/**
 * Эффекты перехода заявки на участия: отклонение заявки отклоняет нерассмотренных; отзыв заявки снимает
 * действующих; повторная подача возвращает отклонённых на рассмотрение.
 */
export async function applyToEntries(
  tx: Tx,
  applicationId: string,
  from: ApplicationStatus,
  to: ApplicationStatus,
  comment: string | null,
): Promise<void> {
  const userId = RequestContextStore.current().user?.id ?? null;
  const now = new Date();
  if (to === 'REJECTED')
    await tx.entry.updateMany({
      where: { applicationId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        decidedAt: now,
        decidedById: userId,
        decisionReason: comment ?? 'application_rejected',
        version: { increment: 1 },
      },
    });
  if (to === 'CANCELLED')
    await tx.entry.updateMany({
      where: { applicationId, status: { in: [...ACTIVE_ENTRY_STATUSES] } },
      data: {
        status: 'WITHDRAWN',
        withdrawnAt: now,
        withdrawnById: userId,
        withdrawReason: 'application_cancelled',
        version: { increment: 1 },
      },
    });
  if (from === 'WAITING_DOCUMENTS' && to === 'SUBMITTED') {
    // Отклонённый участник возвращается на рассмотрение, если спортсмена не заявили в ту же категорию заново.
    const rejected = await tx.entry.findMany({
      where: { applicationId, status: 'REJECTED' },
      select: { id: true, categoryId: true, athleteId: true },
    });
    for (const r of rejected) {
      const duplicate = await tx.entry.findFirst({
        where: {
          categoryId: r.categoryId,
          athleteId: r.athleteId,
          status: { in: [...ACTIVE_ENTRY_STATUSES] },
        },
        select: { id: true },
      });
      if (duplicate) continue;
      await tx.entry.update({
        where: { id: r.id },
        data: {
          status: 'PENDING',
          decidedAt: null,
          decidedById: null,
          decisionReason: null,
          version: { increment: 1 },
        },
      });
    }
  }
}
