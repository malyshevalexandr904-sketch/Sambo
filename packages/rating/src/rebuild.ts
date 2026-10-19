// Пересборка рейтинга спортсмена (docs/RATING_ARCHITECTURE.md, 6.5; ТЗ 18): от начального рейтинга версии правил
// заново проходятся действующие расчёты его схваток и ручные корректировки — по времени. Каждая схватка — по своей
// закреплённой версии правил, с записанным исходом и рейтингом соперника до схватки; ручная корректировка — той же
// разницей. Корректировки изменённого результата не нужны: схватка уже считается по действующему варианту.
// Результат — расхождение с текущим рейтингом; ничего не записывается.
import { rateAthlete } from './elo.js';
import type { RatingOutcome, RatingRules } from './rules.js';

export type RebuildEvent<M> =
  | {
      kind: 'MATCH';
      at: Date;
      id: string;
      rules: RatingRules;
      outcome: RatingOutcome;
      opponentRatingBefore: number;
      meta: M;
    }
  | { kind: 'CORRECTION'; at: Date; id: string; delta: number; meta: M };

export interface RebuildStepResult<M> {
  event: RebuildEvent<M>;
  before: number;
  after: number;
  delta: number;
}

export interface RebuildResult<M> {
  rating: number;
  steps: RebuildStepResult<M>[];
}

/** Порядок: время, затем id (uuid v7 — порядок записи). */
export function replayRating<M>(initialRating: number, events: readonly RebuildEvent<M>[]): RebuildResult<M> {
  const ordered = [...events].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let rating = initialRating;
  const steps: RebuildStepResult<M>[] = [];
  for (const event of ordered) {
    const before = rating;
    rating =
      event.kind === 'MATCH'
        ? rateAthlete(event.rules, {
            rating,
            opponentRating: event.opponentRatingBefore,
            outcome: event.outcome,
          }).ratingAfter
        : rating + event.delta;
    steps.push({ event, before, after: rating, delta: rating - before });
  }
  return { rating, steps };
}
