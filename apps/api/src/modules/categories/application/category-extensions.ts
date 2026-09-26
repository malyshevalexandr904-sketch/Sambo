// Точки расширения категорий турнира: участия считает и переносит модуль заявок, условия переходов категорий
// добавляют модули допуска и взвешивания (Phase 4b). Так categories не зависит от registrations.
import { Injectable } from '@nestjs/common';
import type { CategoryStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';

export interface EntryStats {
  /** Не отклонённые и не снятые участия. */
  active: number;
  approved: number;
  /** Все участия, включая отклонённые и снятые (история). */
  total: number;
}

export interface CategoryMergeHandler {
  /** Спортсмены с действующими участиями сразу в нескольких объединяемых категориях. */
  conflicts(tx: Tx, categoryIds: string[]): Promise<string[]>;
  /** Перенос действующих участий в целевую категорию; заявленная категория участия сохраняется. */
  move(tx: Tx, sourceIds: string[], targetId: string): Promise<number>;
}

export interface CategoryTransitionContext {
  tx: Tx;
  competitionId: string;
  categoryId: string;
  from: CategoryStatus;
  to: CategoryStatus;
}

export type CategoryTransitionCheck = (ctx: CategoryTransitionContext) => Promise<string[]>;

const EMPTY: EntryStats = { active: 0, approved: 0, total: 0 };

@Injectable()
export class CategoryExtensions {
  private statsProvider: ((tx: Tx | null, categoryIds: string[]) => Promise<Map<string, EntryStats>>) | null =
    null;
  private mergeHandler: CategoryMergeHandler | null = null;
  private readonly checks: CategoryTransitionCheck[] = [];

  registerEntryStats(
    provider: (tx: Tx | null, categoryIds: string[]) => Promise<Map<string, EntryStats>>,
  ): void {
    this.statsProvider = provider;
  }

  registerMergeHandler(handler: CategoryMergeHandler): void {
    this.mergeHandler = handler;
  }

  registerTransitionCheck(check: CategoryTransitionCheck): void {
    this.checks.push(check);
  }

  async stats(tx: Tx | null, categoryIds: string[]): Promise<Map<string, EntryStats>> {
    if (!this.statsProvider || categoryIds.length === 0) return new Map();
    return this.statsProvider(tx, categoryIds);
  }

  async statsOf(tx: Tx | null, categoryId: string): Promise<EntryStats> {
    return (await this.stats(tx, [categoryId])).get(categoryId) ?? EMPTY;
  }

  merge(): CategoryMergeHandler | null {
    return this.mergeHandler;
  }

  async check(ctx: CategoryTransitionContext): Promise<string[]> {
    const failed: string[] = [];
    for (const c of this.checks) failed.push(...(await c(ctx)));
    return failed;
  }
}
