// Точки расширения жизненного цикла турнира (ARCHITECTURE.md, 16.1): условия переходов и эффекты, которые
// зависят от категорий, заявок, а позже — жеребьёвки и расписания. Модули регистрируют их при старте, поэтому
// competitions не зависит от них (нет циклов модулей).
import { Injectable } from '@nestjs/common';
import type { CompetitionStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { CompetitionBasics } from './competition-scope.service';

export interface TransitionContext {
  tx: Tx;
  competition: CompetitionBasics;
  from: CompetitionStatus;
  to: CompetitionStatus;
  reason: string | null;
  userId: string | null;
  now: Date;
}

export interface TransitionCheckResult {
  /** Условия не выполнены — переход невозможен. */
  blocking: string[];
  /** Переход возможен после подтверждения пользователем (`confirm: true`). */
  warnings?: string[];
}

export type TransitionCheck = (ctx: TransitionContext) => Promise<TransitionCheckResult>;
export type TransitionEffect = (ctx: TransitionContext) => Promise<void>;

export interface CompetitionCounters {
  categories: number;
  applications: number;
  entriesApproved: number;
  entriesPending: number;
}

export type CountersProvider = (
  tx: Tx | null,
  competitionId: string,
) => Promise<Partial<CompetitionCounters>>;

@Injectable()
export class CompetitionExtensions {
  private readonly checks: TransitionCheck[] = [];
  private readonly effects: TransitionEffect[] = [];
  private readonly counters: CountersProvider[] = [];

  registerCheck(check: TransitionCheck): void {
    this.checks.push(check);
  }

  registerEffect(effect: TransitionEffect): void {
    this.effects.push(effect);
  }

  registerCounters(provider: CountersProvider): void {
    this.counters.push(provider);
  }

  async check(ctx: TransitionContext): Promise<Required<TransitionCheckResult>> {
    const result = { blocking: [] as string[], warnings: [] as string[] };
    for (const check of this.checks) {
      const r = await check(ctx);
      result.blocking.push(...r.blocking);
      result.warnings.push(...(r.warnings ?? []));
    }
    return result;
  }

  async apply(ctx: TransitionContext): Promise<void> {
    for (const effect of this.effects) await effect(ctx);
  }

  async countersFor(competitionId: string): Promise<CompetitionCounters> {
    const result: CompetitionCounters = {
      categories: 0,
      applications: 0,
      entriesApproved: 0,
      entriesPending: 0,
    };
    for (const provider of this.counters) Object.assign(result, await provider(null, competitionId));
    return result;
  }
}
