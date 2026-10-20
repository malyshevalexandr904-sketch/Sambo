import fc from 'fast-check';
import { RatingRuleParametersV1 } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import {
  classifyResult,
  Dec,
  expectedScore,
  isWinOutcome,
  kFactor,
  rateMatch,
  ratingLevel,
  roundRating,
} from './elo.js';
import { RATING_OUTCOMES, type RatingOutcome, SAMBO_ELO_V1 } from './rules.js';

const R = SAMBO_ELO_V1;

/** Как rateMatch, но с произвольными K (контрольные значения калькулятора с K = 50). */
const exactWith = (ra: number, rb: number, sa: string, ka: number, kb: number): [string, string] => {
  const sb = new Dec(1).minus(sa);
  const a = new Dec(ra).plus(new Dec(ka).times(new Dec(sa).minus(expectedScore(ra, rb))));
  const b = new Dec(rb).plus(new Dec(kb).times(sb.minus(expectedScore(rb, ra))));
  return [a.toString(), b.toString()];
};
const close = (actual: string, excel: number) => expect(Math.abs(Number(actual) - excel)).toBeLessThan(1e-9);

describe('Elo against the Excel files (RATING_RULES.md, 7)', () => {
  it('C1: Appendix 5, A 315 loses with minimal advantage of B 145 (K 10 / 30)', () => {
    const { winner, loser } = rateMatch(R, {
      winnerRating: 145,
      loserRating: 315,
      winner: 'WIN_MINIMAL_ADVANTAGE',
      loser: 'LOSS_MINIMAL_ADVANTAGE',
    });
    close(loser.ratingAfterExact, 311.731699277233);
    close(winner.ratingAfterExact, 154.804902168302);
    expect([loser.k, winner.k]).toEqual([10, 30]);
    expect([loser.ratingAfter, winner.ratingAfter]).toEqual([312, 155]);
    expect([loser.delta, winner.delta]).toEqual([-3, 10]);
    expect(Number(loser.expectedScore).toFixed(6)).toBe('0.726830');
  });

  it('C3, C5: the calculator formula with K = 50', () => {
    const [a3, b3] = exactWith(200, 990, '1', 50, 50);
    close(a3, 249.475924427437);
    close(b3, 940.524075572564);
    const [a5, b5] = exactWith(412, 407, '1', 50, 50);
    close(a5, 436.640245914547);
    close(b5, 382.359754085453);
  });

  it.each([
    // [C, winner, loser, outcome, winnerAfter, loserAfter]
    ['C2', 315, 145, 'CLEAN', 318, 137],
    ['C4', 200, 990, 'CLEAN', 230, 980],
    ['C6', 412, 407, 'CLEAN', 417, 402],
    ['C7', 200, 200, 'CLEAN', 215, 185],
    ['C8', 200, 200, 'POINTS', 212, 188],
    ['C9', 200, 200, 'SMALL', 206, 194],
    ['C10', 200, 200, 'MINIMAL', 203, 197],
    ['C11', 100, 100, 'CLEAN', 130, 70],
    ['C12', 301, 300, 'MINIMAL', 302, 297],
    ['C13', 1400, 250, 'CLEAN', 1400, 250],
    ['C14', 1500, 1500, 'CLEAN', 1505, 1495],
  ] as const)('%s: %i beats %i (%s) → %i / %i', (_c, w, l, kind, wa, la) => {
    const pair: Record<string, [RatingOutcome, RatingOutcome]> = {
      CLEAN: ['CLEAN_WIN', 'CLEAN_LOSS'],
      POINTS: ['WIN_ON_POINTS', 'LOSS_ON_POINTS'],
      SMALL: ['WIN_SMALL_ADVANTAGE', 'LOSS_SMALL_ADVANTAGE'],
      MINIMAL: ['WIN_MINIMAL_ADVANTAGE', 'LOSS_MINIMAL_ADVANTAGE'],
    };
    const [winner, loser] = pair[kind] as [RatingOutcome, RatingOutcome];
    const r = rateMatch(R, { winnerRating: w, loserRating: l, winner, loser });
    expect([r.winner.ratingAfter, r.loser.ratingAfter]).toEqual([wa, la]);
  });
});

describe('policies', () => {
  it('K: 60 up to 100, 30 up to 300, 10 above', () => {
    expect([-50, 0, 100, 101, 300, 301, 5000].map((r) => kFactor(R, r))).toEqual([
      60, 60, 60, 30, 30, 10, 10,
    ]);
  });

  it('S is symmetric for every outcome pair', () => {
    for (const o of RATING_OUTCOMES) {
      const mirror = RATING_OUTCOMES[
        RATING_OUTCOMES.length - 1 - RATING_OUTCOMES.indexOf(o)
      ] as RatingOutcome;
      expect(new Dec(R.scoreRules[o]).plus(R.scoreRules[mirror]).toString()).toBe('1');
    }
  });

  it('every result coefficient S of Appendix 5 reaches the formula (200 vs 200, K 30, E 0.5)', () => {
    const expected: [RatingOutcome, string, number][] = [
      ['CLEAN_WIN', '1', 15],
      ['WIN_ON_POINTS', '0.9', 12],
      ['WIN_SMALL_ADVANTAGE', '0.7', 6],
      ['WIN_MINIMAL_ADVANTAGE', '0.6', 3],
      ['LOSS_MINIMAL_ADVANTAGE', '0.4', -3],
      ['LOSS_SMALL_ADVANTAGE', '0.3', -6],
      ['LOSS_ON_POINTS', '0.1', -12],
      ['CLEAN_LOSS', '0', -15],
    ];
    expect(expected.map(([o]) => o)).toEqual([...RATING_OUTCOMES]);
    for (const [outcome, s] of expected) expect(R.scoreRules[outcome]).toBe(s);
    for (const [winner, , delta] of expected.slice(0, 4)) {
      const loser = RATING_OUTCOMES[RATING_OUTCOMES.length - 1 - RATING_OUTCOMES.indexOf(winner)]!;
      const r = rateMatch(R, { winnerRating: 200, loserRating: 200, winner, loser });
      expect([r.winner.delta, r.loser.delta]).toEqual([delta, -delta]);
    }
  });

  it('levels: 1 below 400, then every 200, 10 from 2000', () => {
    expect([-10, 200, 399, 400, 599, 600, 1999, 2000, 9000].map((r) => ratingLevel(R, r))).toEqual([
      1, 1, 1, 2, 2, 3, 9, 10, 10,
    ]);
  });

  it('rounds half away from zero', () => {
    expect(
      ['311.7316', '154.8049', '200.5', '200.4999', '-2.5'].map((v) =>
        roundRating('INTEGER_HALF_UP', new Dec(v)),
      ),
    ).toEqual([312, 155, 201, 200, -3]);
  });

  it('refuses a non-integer rating', () => {
    expect(() =>
      rateMatch(R, { winnerRating: 200.5, loserRating: 200, winner: 'CLEAN_WIN', loser: 'CLEAN_LOSS' }),
    ).toThrow();
  });
});

describe('classifyResult (rules No. 892, RATING_RULES.md 3.1)', () => {
  const c = (
    method: Parameters<typeof classifyResult>[1]['method'],
    methodDetail: string | null = null,
    hasWinner = true,
  ) => classifyResult(R, { method, methodDetail, hasWinner });

  it.each(['TOTAL_VICTORY', 'SUPERIORITY', 'DISQUALIFICATION', 'NO_SHOW', 'WITHDRAWAL', 'INJURY'] as const)(
    '%s is a clean win',
    (m) => expect(c(m, 'ANY')).toEqual({ rated: true, winner: 'CLEAN_WIN', loser: 'CLEAN_LOSS' }),
  );

  it('points by tie-breaker: quality → small advantage, last action or warnings → minimal', () => {
    expect(c('POINTS')).toMatchObject({ winner: 'WIN_ON_POINTS' });
    expect(c('POINTS', '')).toMatchObject({ winner: 'WIN_ON_POINTS' });
    expect(c('POINTS', 'TECHNICAL_POINTS')).toMatchObject({ winner: 'WIN_SMALL_ADVANTAGE' });
    expect(c('POINTS', 'MORE_HIGH_SCORES')).toMatchObject({ winner: 'WIN_SMALL_ADVANTAGE' });
    for (const d of ['LAST_TECHNICAL_ACTION', 'FEWER_PENALTIES', 'LAST_PENALTY'])
      expect(c('POINTS', d)).toEqual({
        rated: true,
        winner: 'WIN_MINIMAL_ADVANTAGE',
        loser: 'LOSS_MINIMAL_ADVANTAGE',
      });
    expect(c('DECISION', 'REFEREE_DECISION')).toMatchObject({ winner: 'WIN_MINIMAL_ADVANTAGE' });
  });

  it('BYE, no winner and unknown combinations are not rated', () => {
    expect(c('BYE')).toEqual({ rated: false, reason: 'BYE' });
    expect(c('NO_SHOW', null, false)).toEqual({ rated: false, reason: 'NO_WINNER' });
    expect(c('POINTS', 'SOMETHING_NEW')).toEqual({ rated: false, reason: 'UNCLASSIFIED' });
  });
});

describe('properties', () => {
  const rating = fc.integer({ min: -500, max: 3000 });
  const outcome = fc.constantFrom('CLEAN', 'WIN_ON_POINTS', 'WIN_SMALL_ADVANTAGE', 'WIN_MINIMAL_ADVANTAGE');

  it('is deterministic, E_A + E_B = 1, the winner never loses rating and the loser never gains', () => {
    fc.assert(
      fc.property(rating, rating, outcome, (w, l, o) => {
        const winner = (o === 'CLEAN' ? 'CLEAN_WIN' : o) as RatingOutcome;
        const loser = RATING_OUTCOMES[
          RATING_OUTCOMES.length - 1 - RATING_OUTCOMES.indexOf(winner)
        ] as RatingOutcome;
        const a = rateMatch(R, { winnerRating: w, loserRating: l, winner, loser });
        const b = rateMatch(R, { winnerRating: w, loserRating: l, winner, loser });
        expect(a).toEqual(b);
        expect(expectedScore(w, l).plus(expectedScore(l, w)).minus(1).abs().lt('1e-30')).toBe(true);
        // При S победителя 0.6 и сильном фаворите изменение может быть отрицательным — по формуле; чистая победа — нет.
        if (winner === 'CLEAN_WIN') {
          expect(a.winner.delta).toBeGreaterThanOrEqual(0);
          expect(a.loser.delta).toBeLessThanOrEqual(0);
        }
      }),
    );
  });
});

describe('rule set parameters schema', () => {
  it('accepts sambo-elo@1', () => {
    expect(RatingRuleParametersV1.safeParse(SAMBO_ELO_V1).success).toBe(true);
  });

  it.each([
    ['asymmetric S', { scoreRules: { ...R.scoreRules, WIN_SMALL_ADVANTAGE: '0.8' } }, 'scores_not_symmetric'],
    [
      'K thresholds out of order',
      {
        kFactorRules: [
          { maxRating: 300, k: 30 },
          { maxRating: 100, k: 60 },
          { maxRating: null, k: 10 },
        ],
      },
      'thresholds_not_ascending',
    ],
    ['no open-ended K', { kFactorRules: [{ maxRating: 100, k: 60 }] }, 'thresholds_not_ascending'],
    [
      'level gap',
      {
        levelRules: [
          { level: 1, from: null },
          { level: 3, from: 400 },
        ],
      },
      'levels_not_ascending',
    ],
    ['BYE in the classifier', { outcomeRules: [{ method: 'BYE', kind: 'CLEAN' }] }, undefined],
    ['unknown field', { ratingFloor: 0 }, undefined],
  ])('rejects %s', (_name, patch, code) => {
    const r = RatingRuleParametersV1.safeParse({ ...R, ...patch });
    expect(r.success).toBe(false);
    if (code) expect(r.error?.issues.map((i) => i.message)).toContain(code);
  });
});

describe('isWinOutcome', () => {
  it('splits the outcomes into the winner and the loser halves', () => {
    expect(RATING_OUTCOMES.filter(isWinOutcome)).toEqual([
      'CLEAN_WIN',
      'WIN_ON_POINTS',
      'WIN_SMALL_ADVANTAGE',
      'WIN_MINIMAL_ADVANTAGE',
    ]);
    expect(() => isWinOutcome('DRAW')).toThrow(/unknown/);
  });
});
