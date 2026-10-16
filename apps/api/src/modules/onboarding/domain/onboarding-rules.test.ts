import { describe, expect, it } from 'vitest';
import { isEditable, normalizeOrganizationName, onboardingTransition, reviewerOf } from './onboarding-rules';

const base = { role: 'ATHLETE' as const, kind: 'REGISTRATION' as const, inOrganization: false };

describe('onboarding transitions', () => {
  it('sends a request to the platform or to the organization depending on the scenario', () => {
    expect(onboardingTransition({ ...base, status: 'DRAFT' }, 'submit', 'APPLICANT')).toEqual({
      ok: true,
      to: 'PENDING_REVIEW',
      reasonRequired: false,
    });
    expect(
      onboardingTransition({ ...base, inOrganization: true, status: 'DRAFT' }, 'submit', 'APPLICANT'),
    ).toMatchObject({ ok: true, to: 'PENDING_ORGANIZATION_APPROVAL' });
    expect(
      onboardingTransition(
        {
          ...base,
          role: 'COACH',
          kind: 'JOIN_ORGANIZATION',
          inOrganization: null,
          status: 'CHANGES_REQUESTED',
        },
        'submit',
        'APPLICANT',
      ),
    ).toMatchObject({ ok: true, to: 'PENDING_ORGANIZATION_APPROVAL' });
    expect(
      onboardingTransition(
        { ...base, role: 'REFEREE', inOrganization: true, status: 'DRAFT' },
        'submit',
        'APPLICANT',
      ),
    ).toMatchObject({ ok: true, to: 'PENDING_REVIEW' });
  });

  it('forbids a second submission and decisions by the wrong reviewer', () => {
    expect(onboardingTransition({ ...base, status: 'PENDING_REVIEW' }, 'submit', 'APPLICANT')).toEqual({
      ok: false,
      allowed: ['cancel'],
    });
    expect(onboardingTransition({ ...base, status: 'PENDING_REVIEW' }, 'approve', 'ORGANIZATION').ok).toBe(
      false,
    );
    expect(
      onboardingTransition({ ...base, status: 'PENDING_ORGANIZATION_APPROVAL' }, 'approve', 'PLATFORM').ok,
    ).toBe(false);
    expect(onboardingTransition({ ...base, status: 'APPROVED' }, 'reject', 'PLATFORM').ok).toBe(false);
    expect(onboardingTransition({ ...base, status: 'APPROVED' }, 'cancel', 'APPLICANT').ok).toBe(false);
  });

  it('requires a reason for rejection and for requested changes', () => {
    expect(onboardingTransition({ ...base, status: 'PENDING_REVIEW' }, 'reject', 'PLATFORM')).toEqual({
      ok: true,
      to: 'REJECTED',
      reasonRequired: true,
    });
    expect(
      onboardingTransition(
        { ...base, status: 'PENDING_ORGANIZATION_APPROVAL' },
        'request_changes',
        'ORGANIZATION',
      ),
    ).toEqual({ ok: true, to: 'CHANGES_REQUESTED', reasonRequired: true });
    expect(onboardingTransition({ ...base, status: 'PENDING_REVIEW' }, 'approve', 'PLATFORM')).toEqual({
      ok: true,
      to: 'APPROVED',
      reasonRequired: false,
    });
  });

  it('knows editable statuses and who reviews', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('CHANGES_REQUESTED')).toBe(true);
    expect(isEditable('PENDING_REVIEW')).toBe(false);
    expect(reviewerOf('PENDING_REVIEW')).toBe('PLATFORM');
    expect(reviewerOf('PENDING_ORGANIZATION_APPROVAL')).toBe('ORGANIZATION');
    expect(reviewerOf('APPROVED')).toBeNull();
  });
});

describe('organization name normalization', () => {
  it('ignores case, ё, quotes and the legal form', () => {
    expect(normalizeOrganizationName('ООО «Самбо-70»')).toBe('самбо-70');
    expect(normalizeOrganizationName('  самбо-70 ')).toBe('самбо-70');
    expect(normalizeOrganizationName('АНО ДО "Клуб Ёлка"')).toBe('клуб елка');
    expect(normalizeOrganizationName('Клуб Звезда')).not.toBe(normalizeOrganizationName('Клуб Звёзды'));
  });
});
