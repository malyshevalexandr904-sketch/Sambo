import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rateAthlete, rateMatch } from './elo.js';
import { type RebuildEvent, replayRating } from './rebuild.js';
import { RATING_OUTCOMES, SAMBO_ELO_V1 } from './rules.js';

const R = SAMBO_ELO_V1;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));

describe('rating rebuild (RATING_ARCHITECTURE.md, 6.5)', () => {
  it('replays matches in time order with the recorded opponent rating, and carries manual corrections as a delta', () => {
    const events: RebuildEvent<string>[] = [
      { kind: 'CORRECTION', at: at(5), id: 'c1', delta: 15, meta: 'manual' },
      // Записаны не по порядку — пересборка идёт по времени.
      {
        kind: 'MATCH',
        at: at(10),
        id: 'm2',
        rules: R,
        outcome: 'LOSS_ON_POINTS',
        opponentRatingBefore: 250,
        meta: 'second',
      },
      {
        kind: 'MATCH',
        at: at(1),
        id: 'm1',
        rules: R,
        outcome: 'CLEAN_WIN',
        opponentRatingBefore: 200,
        meta: 'first',
      },
    ];
    const r = replayRating(200, events);
    expect(r.steps.map((s) => s.event.meta)).toEqual(['first', 'manual', 'second']);
    // 200 против 200, чистая победа, K 30: +15.
    expect(r.steps[0]).toMatchObject({ before: 200, after: 215, delta: 15 });
    expect(r.steps[1]).toMatchObject({ before: 215, after: 230, delta: 15 });
    const third = rateAthlete(R, { rating: 230, opponentRating: 250, outcome: 'LOSS_ON_POINTS' });
    expect(r.steps[2]).toMatchObject({ before: 230, after: third.ratingAfter });
    expect(r.rating).toBe(third.ratingAfter);
  });

  it('gives the same rating as the calculation when nothing was changed', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            opponent: fc.integer({ min: 0, max: 2500 }),
            outcome: fc.constantFrom(...RATING_OUTCOMES),
          }),
          { maxLength: 30 },
        ),
        (matches) => {
          let rating = R.initialRating;
          const events: RebuildEvent<null>[] = matches.map((m, i) => {
            const won = RATING_OUTCOMES.indexOf(m.outcome) < RATING_OUTCOMES.length / 2;
            const mirror = RATING_OUTCOMES[RATING_OUTCOMES.length - 1 - RATING_OUTCOMES.indexOf(m.outcome)]!;
            const c = rateMatch(R, {
              winnerRating: won ? rating : m.opponent,
              loserRating: won ? m.opponent : rating,
              winner: won ? m.outcome : mirror,
              loser: won ? mirror : m.outcome,
            });
            rating = (won ? c.winner : c.loser).ratingAfter;
            return {
              kind: 'MATCH',
              at: at(i),
              id: String(i).padStart(3, '0'),
              rules: R,
              outcome: m.outcome,
              opponentRatingBefore: m.opponent,
              meta: null,
            };
          });
          expect(replayRating(R.initialRating, events).rating).toBe(rating);
        },
      ),
    );
  });
});
