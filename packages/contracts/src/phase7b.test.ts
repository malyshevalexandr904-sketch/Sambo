import { describe, expect, it } from 'vitest';
import { MatchTransitionRequest } from './matches.js';
import {
  formatMatchClock,
  ManualMatchCreate,
  MatchResultAmend,
  medalForPlace,
  MedicalIncidentCreate,
} from './results.js';

describe('medals by place', () => {
  it('gold, silver, bronze for 1–3 and nothing below', () => {
    expect([1, 2, 3, 3, 5, 7].map(medalForPlace)).toEqual(['GOLD', 'SILVER', 'BRONZE', 'BRONZE', null, null]);
  });
});

describe('Phase 7b command schemas', () => {
  it('requires a reason to postpone or cancel a match', () => {
    expect(MatchTransitionRequest.safeParse({ to: 'POSTPONED' }).success).toBe(false);
    expect(MatchTransitionRequest.safeParse({ to: 'POSTPONED', reason: 'Врач на ковре' }).success).toBe(true);
    expect(MatchTransitionRequest.safeParse({ to: 'CANCELLED' }).success).toBe(false);
    expect(MatchTransitionRequest.safeParse({ to: 'READY' }).success).toBe(true);
  });

  it('amends with a winner and a reason, never to a BYE', () => {
    expect(
      MatchResultAmend.safeParse({ winnerSide: 'RED', method: 'POINTS', reason: 'Ошибка табло' }).success,
    ).toBe(true);
    expect(MatchResultAmend.safeParse({ winnerSide: 'RED', method: 'POINTS' }).success).toBe(false);
    expect(
      MatchResultAmend.safeParse({ winnerSide: 'RED', method: 'BYE', reason: 'Ошибка табло' }).success,
    ).toBe(false);
  });

  it('withdraws by the doctor only with a stoppage', () => {
    expect(
      MedicalIncidentCreate.safeParse({ side: 'RED', kind: 'ASSISTANCE', decision: 'WITHDRAWN_BY_DOCTOR' })
        .success,
    ).toBe(false);
    expect(
      MedicalIncidentCreate.safeParse({ side: 'RED', kind: 'STOPPAGE', decision: 'WITHDRAWN_BY_DOCTOR' })
        .success,
    ).toBe(true);
  });

  it('needs two different participants for a manual match', () => {
    const id = '01920000-0000-7000-8000-000000000001';
    const base = { label: 'Переигровка', durationSeconds: 120, matId: id, sessionId: id };
    expect(ManualMatchCreate.safeParse({ ...base, redEntryId: id, blueEntryId: id }).success).toBe(false);
  });

  it('prints the match clock as M:SS', () => {
    expect([0, 59_999, 60_000, 185_000].map(formatMatchClock)).toEqual(['0:00', '0:59', '1:00', '3:05']);
  });
});
