// Пример расчёта на главной совпадает с контрольными примерами docs/RATING_RULES.md, раздел 7.
import { describe, expect, it } from 'vitest';
import { eloAfter, levelOf } from './rating-example';

describe('rating example on the home page', () => {
  it.each([
    [315, 145, 0.4, [312, 155]],
    [315, 145, 1, [318, 137]],
    [200, 990, 1, [230, 980]],
    [200, 200, 0.9, [212, 188]],
    [200, 200, 0.6, [203, 197]],
    [100, 100, 1, [130, 70]],
    [301, 300, 0.6, [302, 297]],
    [1400, 250, 1, [1400, 250]],
  ])('%i vs %i, S = %f', (a, b, s, result) => {
    expect(eloAfter(a, b, s)).toEqual(result);
  });

  it('levels 1–10 by 200 points', () => {
    expect([150, 200, 399, 400, 1999, 2000, 5000].map(levelOf)).toEqual([1, 1, 1, 2, 9, 10, 10]);
  });
});
