// Проекция итога взвешивания (WeighInRecord): пересчитывается из попыток в транзакции записи попытки, перевода
// категории и пересчёта допуска. Пишется только при изменении.
import { Injectable } from '@nestjs/common';
import type {
  WeighInAttemptDto,
  WeighInFailureOutcome,
  WeighInRecordDto,
  WeighInStatus,
  WeightLimits,
} from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import { toCategoryRef } from '../../admission';
import { type AttemptFact, allowedAttemptKinds, type Derived, deriveWeighIn } from '../domain/weighin-rules';

export const ATTEMPT_INCLUDE = {
  category: { select: { id: true, code: true, nameRu: true, nameEn: true, weightKind: true } },
  scale: { select: { id: true, name: true } },
} satisfies Prisma.WeighInAttemptInclude;

export type AttemptRow = Prisma.WeighInAttemptGetPayload<{ include: typeof ATTEMPT_INCLUDE }>;

export function toAttemptDto(a: AttemptRow): WeighInAttemptDto {
  return {
    id: a.id,
    entryId: a.entryId,
    category: toCategoryRef(a.category),
    windowId: a.windowId,
    scale: a.scale,
    weightGrams: a.weightGrams,
    measuredAt: a.measuredAt.toISOString(),
    kind: a.kind,
    result: a.result,
    limits: { kind: a.category.weightKind, lowerGrams: a.limitLowerGrams, upperGrams: a.limitUpperGrams },
    toleranceGrams: a.toleranceGrams,
    note: a.note,
  };
}

export function toRecordDto(
  entryId: string,
  status: WeighInStatus,
  last: AttemptRow | null,
): WeighInRecordDto {
  return {
    entryId,
    status,
    lastAttempt: last ? toAttemptDto(last) : null,
    allowedKinds: allowedAttemptKinds(status),
  };
}

export const limitsOf = (c: {
  weightKind: WeightLimits['kind'];
  weightLowerGrams: number | null;
  weightUpperGrams: number | null;
}): WeightLimits => ({ kind: c.weightKind, lowerGrams: c.weightLowerGrams, upperGrams: c.weightUpperGrams });

export interface RefreshedRecord extends Derived {
  entryId: string;
  /** Границы текущей категории участия. */
  limits: WeightLimits;
}

@Injectable()
export class WeighInRecords {
  /** Пересчёт итогов участий турнира; возвращает итог по каждому участию (без попыток — EXPECTED). */
  async refresh(
    tx: Tx,
    competition: { id: string; outcome: WeighInFailureOutcome },
    entryIds: string[],
    now: Date,
  ): Promise<Map<string, RefreshedRecord>> {
    if (entryIds.length === 0) return new Map();
    const entries = await tx.entry.findMany({
      where: { id: { in: entryIds } },
      select: {
        id: true,
        categoryId: true,
        category: { select: { weightKind: true, weightLowerGrams: true, weightUpperGrams: true } },
        weighInRecord: { select: { status: true, lastAttemptId: true } },
      },
    });
    const attempts = await tx.weighInAttempt.findMany({
      where: { entryId: { in: entryIds } },
      select: {
        id: true,
        entryId: true,
        kind: true,
        result: true,
        measuredAt: true,
        weightGrams: true,
        categoryId: true,
        toleranceGrams: true,
      },
    });
    const openCategories = await this.categoriesWithWindows(
      tx,
      competition.id,
      entries.map((e) => e.categoryId),
      now,
    );
    const result = new Map<string, RefreshedRecord>();
    for (const e of entries) {
      const own: AttemptFact[] = attempts.filter((a) => a.entryId === e.id);
      const limits = limitsOf(e.category);
      const derived = deriveWeighIn(own, {
        categoryId: e.categoryId,
        limits,
        outcome: competition.outcome,
        recheckPossible: openCategories.has(e.categoryId),
      });
      result.set(e.id, { entryId: e.id, ...derived, limits });
      if (own.length > 0 || e.weighInRecord)
        await this.store(tx, competition.id, e.id, e.weighInRecord, derived);
    }
    return result;
  }

  private async store(
    tx: Tx,
    competitionId: string,
    entryId: string,
    stored: { status: WeighInStatus; lastAttemptId: string | null } | null,
    derived: Derived,
  ): Promise<void> {
    if (stored && stored.status === derived.status && stored.lastAttemptId === derived.lastAttemptId) return;
    await tx.weighInRecord.upsert({
      where: { entryId },
      create: { entryId, competitionId, status: derived.status, lastAttemptId: derived.lastAttemptId },
      update: { status: derived.status, lastAttemptId: derived.lastAttemptId },
    });
  }

  /** Категории, у которых есть окно взвешивания, ещё не закончившееся. */
  private async categoriesWithWindows(
    tx: Tx,
    competitionId: string,
    categoryIds: string[],
    now: Date,
  ): Promise<Set<string>> {
    const rows = await tx.weighInWindowCategory.findMany({
      where: { competitionId, categoryId: { in: categoryIds }, window: { endsAt: { gt: now } } },
      select: { categoryId: true },
    });
    return new Set(rows.map((r) => r.categoryId));
  }
}
