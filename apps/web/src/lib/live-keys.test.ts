import { describe, expect, it } from 'vitest';
import { competitionKeys } from './live';

const ID = 'c1';
const changed = (topics: string[]) =>
  ({ topics, categoryIds: [], matIds: [], matchIds: [] }) as Parameters<typeof competitionKeys>[1];

describe('competitionKeys', () => {
  it('a weigh-in change refreshes the tournament card and weigh-in sections, not the officiating screens', () => {
    const keys = competitionKeys(ID, changed(['weighin']));
    expect(keys).toContainEqual({ exact: ['competitions', ID] });
    expect(keys).toContainEqual(['competitions', ID, 'weigh-in']);
    expect(keys).toContainEqual(['competitions', ID, 'admission']);
    expect(keys).not.toContainEqual(['competitions', ID]);
    expect(keys).not.toContainEqual(['competitions', ID, 'officiating']);
    expect(keys).not.toContainEqual(['mats']);
  });

  it('a match change refreshes officiating, confirmations, results, brackets and mats', () => {
    const keys = competitionKeys(ID, changed(['matches']));
    for (const section of ['officiating', 'pending-confirmations', 'results', 'draws', 'schedule'])
      expect(keys).toContainEqual(['competitions', ID, section]);
    expect(keys).toContainEqual(['mats']);
    expect(keys).toContainEqual(['matches']);
    expect(keys).toContainEqual(['categories']);
  });

  it('a tournament or entry change, or a resync without payload, refreshes everything of the tournament', () => {
    expect(competitionKeys(ID, changed(['competition']))).toContainEqual(['competitions', ID]);
    expect(competitionKeys(ID, changed(['registrations']))).toContainEqual(['competitions', ID]);
    const all = competitionKeys(ID, null);
    expect(all).toContainEqual(['competitions', ID]);
    expect(all).toContainEqual(['athletes']);
    expect(all).toContainEqual(['applications']);
  });
});
