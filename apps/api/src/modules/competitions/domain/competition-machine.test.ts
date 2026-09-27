import { describe, expect, it } from 'vitest';
import {
  findTransition,
  isPublished,
  publishIssues,
  registrationWindow,
  reopenIssues,
  transitionsFrom,
} from './competition-machine';
import { competitionSlugBase } from './competition-slug';

const schedule = {
  timezone: 'Europe/Moscow',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  registrationStartsAt: '2026-10-01T00:00:00Z',
  registrationEndsAt: '2026-11-10T20:59:59Z',
};
const now = new Date('2026-10-05T12:00:00Z');

describe('competition state machine', () => {
  it('publication needs competition.publish; other steps — competition.transition; cancel and rollbacks need a reason', () => {
    expect(findTransition('DRAFT', 'REGISTRATION_OPEN')).toMatchObject({
      permission: 'competition.publish',
      reasonRequired: false,
    });
    expect(findTransition('REGISTRATION_CLOSED', 'REGISTRATION_OPEN')?.reasonRequired).toBe(true);
    expect(findTransition('DRAWING', 'CHECK_IN')?.reasonRequired).toBe(true);
    expect(findTransition('IN_PROGRESS', 'CANCELLED')?.reasonRequired).toBe(true);
    expect(findTransition('FINISHED', 'CANCELLED')).toBeNull();
    expect(findTransition('DRAFT', 'CHECK_IN')).toBeNull();
    expect(transitionsFrom('CHECK_IN').map((t) => t.to)).toEqual(['DRAWING', 'CANCELLED']);
    expect(transitionsFrom('ARCHIVED')).toEqual([]);
  });

  it('a competition is published from registration on; a cancelled draft is not', () => {
    expect(isPublished('DRAFT')).toBe(false);
    expect(isPublished('CANCELLED')).toBe(false);
    expect(isPublished('REGISTRATION_OPEN')).toBe(true);
    expect(isPublished('ARCHIVED')).toBe(true);
  });

  it('publication requires a published rule set of the same discipline and a consistent schedule', () => {
    const ok = { ...schedule, ruleSetVersionStatus: 'PUBLISHED' as const, ruleSetDisciplineMatches: true };
    expect(publishIssues(ok, now)).toEqual([]);
    expect(publishIssues({ ...ok, ruleSetVersionStatus: 'DRAFT' }, now)).toEqual(['ruleset_not_published']);
    expect(publishIssues({ ...ok, ruleSetDisciplineMatches: false }, now)).toEqual([
      'ruleset_discipline_mismatch',
    ]);
    expect(publishIssues(ok, new Date('2026-11-11T00:00:00Z'))).toEqual(['registration_ends_in_past']);
    // 00:30 по Москве 15 ноября — позже даты начала турнира в его часовом поясе.
    expect(publishIssues({ ...ok, registrationEndsAt: '2026-11-14T21:30:00Z' }, now)).toEqual([
      'registration_after_start',
    ]);
  });

  it('reopening registration needs a new deadline in the future and before the start in the competition timezone', () => {
    expect(reopenIssues(schedule, undefined, now)).toEqual(['registration_ends_at_required']);
    expect(reopenIssues(schedule, '2026-10-01T00:00:00Z', now)).toEqual(['registration_ends_in_past']);
    expect(reopenIssues(schedule, '2026-11-13T20:59:59Z', now)).toEqual([]);
    expect(reopenIssues(schedule, '2026-11-14T21:00:00Z', now)).toEqual(['registration_after_start']);
  });

  it('the registration window is [startsAt, endsAt) of an open competition', () => {
    const c = {
      status: 'REGISTRATION_OPEN' as const,
      registrationStartsAt: new Date(schedule.registrationStartsAt),
      registrationEndsAt: new Date(schedule.registrationEndsAt),
    };
    expect(registrationWindow(c, new Date('2026-09-30T23:59:59Z'))).toBe('NOT_OPEN');
    expect(registrationWindow(c, new Date('2026-10-01T00:00:00Z'))).toBe('OPEN');
    expect(registrationWindow(c, new Date('2026-11-10T20:59:58Z'))).toBe('OPEN');
    expect(registrationWindow(c, new Date('2026-11-10T20:59:59Z'))).toBe('CLOSED');
    expect(registrationWindow({ ...c, status: 'DRAFT' }, now)).toBe('NOT_OPEN');
    expect(registrationWindow({ ...c, status: 'REGISTRATION_CLOSED' }, now)).toBe('CLOSED');
  });

  it('slug gets the start year unless the name already has it', () => {
    expect(competitionSlugBase('otkrytoe-pervenstvo-kluba', '2026-11-14')).toBe(
      'otkrytoe-pervenstvo-kluba-2026',
    );
    expect(competitionSlugBase('kubok-2026-goda', '2026-11-14')).toBe('kubok-2026-goda');
  });
});
