import { describe, expect, it } from 'vitest';
import {
  applicationTransitionsFrom,
  findApplicationTransition,
  isEditableByOwner,
  isUnderStaffReview,
} from './application-machine';
import { buildSnapshot, decisionAllowed, isActiveEntry } from './entry-rules';

describe('application state machine (C-02)', () => {
  it('the owner submits and cancels; the staff reviews, returns, approves and rejects', () => {
    expect(findApplicationTransition('DRAFT', 'SUBMITTED')).toMatchObject({
      actor: 'OWNER',
      permission: null,
    });
    expect(findApplicationTransition('WAITING_DOCUMENTS', 'SUBMITTED')?.actor).toBe('OWNER');
    expect(findApplicationTransition('UNDER_REVIEW', 'APPROVED')).toMatchObject({
      actor: 'STAFF',
      permission: 'registration.approve',
    });
    expect(findApplicationTransition('UNDER_REVIEW', 'REJECTED')).toMatchObject({
      permission: 'registration.reject',
      commentRequired: true,
    });
    expect(findApplicationTransition('SUBMITTED', 'WAITING_DOCUMENTS')).toMatchObject({
      permission: 'registration.return',
      commentRequired: true,
    });
    expect(findApplicationTransition('APPROVED', 'CANCELLED')).toBeNull();
    expect(findApplicationTransition('DRAFT', 'APPROVED')).toBeNull();
    expect(
      applicationTransitionsFrom('SUBMITTED')
        .map((t) => t.to)
        .sort(),
    ).toEqual(['CANCELLED', 'UNDER_REVIEW', 'WAITING_DOCUMENTS']);
  });

  it('the owner edits a draft or a returned application; the staff decides on submitted ones', () => {
    expect(isEditableByOwner('DRAFT')).toBe(true);
    expect(isEditableByOwner('WAITING_DOCUMENTS')).toBe(true);
    expect(isEditableByOwner('SUBMITTED')).toBe(false);
    expect(isUnderStaffReview('SUBMITTED')).toBe(true);
    expect(isUnderStaffReview('APPROVED')).toBe(false);
  });
});

describe('entries', () => {
  it('decisions: pending → approved | rejected; rejected can be approved on re-review; approved only withdraws', () => {
    expect(decisionAllowed('PENDING', 'APPROVED')).toBe(true);
    expect(decisionAllowed('PENDING', 'REJECTED')).toBe(true);
    expect(decisionAllowed('REJECTED', 'APPROVED')).toBe(true);
    expect(decisionAllowed('REJECTED', 'REJECTED')).toBe(false);
    expect(decisionAllowed('APPROVED', 'REJECTED')).toBe(false);
    expect(decisionAllowed('WITHDRAWN', 'APPROVED')).toBe(false);
    expect(isActiveEntry('APPROVED')).toBe(true);
    expect(isActiveEntry('REJECTED')).toBe(false);
  });

  it('the snapshot takes the primary club and the athlete region, otherwise the club region; public name per Q-04', () => {
    const snap = buildSnapshot({
      lastName: 'Иванов',
      firstName: 'пётр',
      middleName: 'Сергеевич',
      birthDate: '2013-05-17',
      gender: 'MALE',
      club: { id: 'club', name: 'СШ «Самбо-70»', regionId: 'club-region' },
      coachName: 'Петров Пётр',
      personRegionId: null,
      rankCode: 'YOUTH_1',
    });
    expect(snap).toMatchObject({
      publicName: 'Иванов П.',
      snapClubId: 'club',
      snapRegionId: 'club-region',
      snapRankCode: 'YOUTH_1',
      snapCoachName: 'Петров Пётр',
    });
    expect(buildSnapshot({ ...snapSource(), personRegionId: 'own' }).snapRegionId).toBe('own');
  });
});

function snapSource() {
  return {
    lastName: 'Иванов',
    firstName: 'Пётр',
    middleName: null,
    birthDate: '2013-05-17',
    gender: 'MALE' as const,
    club: null,
    coachName: null,
    personRegionId: null,
    rankCode: null,
  };
}
