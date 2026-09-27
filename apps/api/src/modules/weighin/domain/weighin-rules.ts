// Итог взвешивания участия (ARCHITECTURE.md, 14.3, 16.4; D-06): выводится из попыток. Официальная и повторная
// попытки определяют итог; контрольная после пройденного официального может потребовать повторного взвешивания.
import {
  type WeighInAttemptKind,
  type WeighInFailureOutcome,
  type WeighInResult,
  weighInResult,
  type WeighInStatus,
  type WeightLimits,
} from '@sde/contracts';

export interface AttemptFact {
  id: string;
  kind: WeighInAttemptKind;
  result: WeighInResult;
  measuredAt: Date;
  weightGrams: number;
  categoryId: string;
  toleranceGrams: number;
}

export interface DerivationContext {
  /** Текущая категория участия: после перевода итог пересчитывается по её границам. */
  categoryId: string;
  limits: WeightLimits;
  outcome: WeighInFailureOutcome;
  /** Есть окно этой категории, которое ещё не закончилось: повторное взвешивание возможно. */
  recheckPossible: boolean;
}

export interface Derived {
  status: WeighInStatus;
  /** Последняя попытка любого вида — для показа последнего веса. */
  lastAttemptId: string | null;
  /** Попытка, по которой получен итог, и её результат для текущей категории. */
  decisive: { attempt: AttemptFact; result: WeighInResult } | null;
}

const byTime = (a: AttemptFact, b: AttemptFact): number => a.measuredAt.getTime() - b.measuredAt.getTime();

/**
 * Итог: нет официальных попыток — EXPECTED. Последняя официальная (или повторная) пройдена — PASSED, но
 * неудачная контрольная после неё требует повторного взвешивания. Не пройдена — по положению (D-06): повторное
 * взвешивание, пока есть окно, иначе FAILED (снятие или перевод в другую категорию решают отдельно).
 */
export function deriveWeighIn(attempts: readonly AttemptFact[], ctx: DerivationContext): Derived {
  const sorted = [...attempts].sort(byTime);
  const lastAttemptId = sorted[sorted.length - 1]?.id ?? null;
  const official = sorted.filter((a) => a.kind !== 'CONTROL');
  const last = official[official.length - 1];
  if (!last) return { status: 'EXPECTED', lastAttemptId, decisive: null };
  const result =
    last.categoryId === ctx.categoryId
      ? last.result
      : weighInResult(last.weightGrams, ctx.limits, last.toleranceGrams);
  const decisive = { attempt: last, result };
  if (result === 'PASSED') {
    const controls = sorted.filter((a) => a.kind === 'CONTROL' && a.measuredAt > last.measuredAt);
    const control = controls[controls.length - 1];
    if (control?.result !== 'FAILED') return { status: 'PASSED', lastAttemptId, decisive };
    return { status: ctx.recheckPossible ? 'RECHECK_REQUIRED' : 'FAILED', lastAttemptId, decisive };
  }
  const recheck = last.kind === 'OFFICIAL' && ctx.outcome === 'RECHECK' && ctx.recheckPossible;
  return { status: recheck ? 'RECHECK_REQUIRED' : 'FAILED', lastAttemptId, decisive };
}

/** Какие попытки можно записать при этом итоге. */
export function allowedAttemptKinds(status: WeighInStatus): WeighInAttemptKind[] {
  switch (status) {
    case 'EXPECTED':
      return ['OFFICIAL'];
    case 'RECHECK_REQUIRED':
      return ['RECHECK'];
    case 'PASSED':
      return ['CONTROL'];
    default:
      return [];
  }
}

export interface WindowPeriod {
  id: string;
  kind: 'OFFICIAL' | 'CONTROL';
  startsAt: Date;
  endsAt: Date;
  categoryIds: readonly string[];
}

/** Окна одного вида пересекаются по времени для общей категории (API.md, 5.6: VALIDATION_FAILED). */
export function overlappingWindow(
  candidate: WindowPeriod,
  others: readonly WindowPeriod[],
): WindowPeriod | null {
  return (
    others.find(
      (w) =>
        w.id !== candidate.id &&
        w.kind === candidate.kind &&
        w.startsAt < candidate.endsAt &&
        candidate.startsAt < w.endsAt &&
        w.categoryIds.some((c) => candidate.categoryIds.includes(c)),
    ) ?? null
  );
}

/** Окно открыто: начало включительно, конец — нет. */
export const windowOpen = (w: { startsAt: Date; endsAt: Date }, now: Date): boolean =>
  w.startsAt <= now && now < w.endsAt;
