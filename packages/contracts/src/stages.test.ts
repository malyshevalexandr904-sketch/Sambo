import { describe, expect, it } from 'vitest';
import { COMPETITION_STATUSES } from './competitions.js';
import { publicSectionsOf, stageOfCompetition, TOURNAMENT_STAGES } from './stages.js';

describe('стадии турнира (правки 05.11.2026)', () => {
  it('каждый статус, кроме отмены, — стадия из списка', () => {
    for (const s of COMPETITION_STATUSES) {
      const stage = stageOfCompetition(s);
      if (s === 'CANCELLED') expect(stage).toBeNull();
      else expect(TOURNAMENT_STAGES).toContain(stage);
    }
  });

  it('статусы по стадиям пользователя', () => {
    expect(stageOfCompetition('DRAFT')).toBe('REVIEW');
    expect(stageOfCompetition('REGISTRATION_CLOSED')).toBe('MANDATE');
    expect(stageOfCompetition('CHECK_IN')).toBe('WEIGH_IN');
    expect(stageOfCompetition('SCHEDULED')).toBe('DRAW');
    expect(stageOfCompetition('ARCHIVED')).toBe('FINISHED');
  });

  it('разделы публичной страницы по стадиям', () => {
    expect(publicSectionsOf('PUBLISHED')).toEqual(['poster', 'regulation', 'registration']);
    expect(publicSectionsOf('REGISTRATION_CLOSED')).toEqual(['poster', 'regulation', 'registration']);
    expect(publicSectionsOf('DRAWING')).toEqual(['poster', 'regulation', 'registration', 'brackets', 'live']);
    expect(publicSectionsOf('IN_PROGRESS')).toContain('live');
    expect(publicSectionsOf('FINISHED')).toEqual(['poster', 'regulation', 'brackets', 'media']);
  });
});
