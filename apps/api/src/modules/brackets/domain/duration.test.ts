import { describe, expect, it } from 'vitest';
import { matchDurationSeconds, youngestAge } from './duration';
import { type Source, sourceFromRecord, sourceToRecord } from './graph';
import { strategyFor } from './strategies';

const params = {
  matchDuration: [
    { ageFrom: 11, ageTo: 13, seconds: 180 },
    { ageFrom: 14, ageTo: 17, seconds: 240 },
  ],
  repechageMatchSeconds: 150,
};

describe('match duration snapshot', () => {
  it('takes the youngest age of the category', () => {
    expect(
      youngestAge({ policy: 'BY_BIRTH_YEAR', ageFrom: 13, birthYearTo: null, referenceYear: 2026 }),
    ).toBe(13);
    expect(
      youngestAge({ policy: 'BIRTH_YEAR_RANGE', ageFrom: null, birthYearTo: 2013, referenceYear: 2026 }),
    ).toBe(13);
    expect(
      youngestAge({ policy: 'BIRTH_YEAR_RANGE', ageFrom: null, birthYearTo: null, referenceYear: 2026 }),
    ).toBe(null);
  });

  it('uses the matching row, the repechage duration and nothing outside the rules', () => {
    expect(matchDurationSeconds(params, 13, false)).toBe(180);
    expect(matchDurationSeconds(params, 14, false)).toBe(240);
    expect(matchDurationSeconds(params, 14, true)).toBe(150);
    expect(matchDurationSeconds({ matchDuration: params.matchDuration }, 14, true)).toBe(240);
    expect(matchDurationSeconds(params, 9, false)).toBeNull();
    expect(matchDurationSeconds(params, null, false)).toBeNull();
  });
});

describe('source records', () => {
  it('round-trip every source of every 5a graph', () => {
    for (const format of ['ROUND_ROBIN', 'SINGLE_ELIMINATION', 'ELIMINATION_WITH_REPECHAGE'] as const) {
      const graph = strategyFor(format)!.build(format === 'ROUND_ROBIN' ? 7 : 32);
      for (const node of graph.nodes)
        for (const source of [node.red, node.blue] as Source[]) {
          const r = sourceToRecord(source);
          expect(sourceFromRecord(r.type, r.ref)).toEqual(source);
        }
    }
  });

  it('rejects unknown dynamic rules', () => {
    expect(() => sourceFromRecord('DYNAMIC', 'SOMETHING:A:1')).toThrow();
    expect(() => sourceFromRecord('POOL_RANK', '1')).toThrow();
  });
});
