import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  creatorRole,
  MEMBERSHIP_TRANSITIONS,
  ORGANIZATION_TRANSITIONS,
  slugify,
} from './organization-rules';

describe('organization transitions', () => {
  it('allows approval and requires a reason for suspension', () => {
    expect(checkTransition(ORGANIZATION_TRANSITIONS, 'PENDING_REVIEW', 'ACTIVE')).toEqual({
      ok: true,
      reasonRequired: false,
    });
    expect(checkTransition(ORGANIZATION_TRANSITIONS, 'ACTIVE', 'SUSPENDED')).toEqual({
      ok: true,
      reasonRequired: true,
    });
  });

  it('lists allowed targets for an invalid transition', () => {
    expect(checkTransition(ORGANIZATION_TRANSITIONS, 'ARCHIVED', 'ACTIVE')).toEqual({
      ok: false,
      allowed: [],
    });
    expect(checkTransition(ORGANIZATION_TRANSITIONS, 'PENDING_REVIEW', 'SUSPENDED')).toEqual({
      ok: false,
      allowed: ['ACTIVE', 'ARCHIVED'],
    });
  });

  it('membership cannot be re-activated after it ended', () => {
    expect(checkTransition(MEMBERSHIP_TRANSITIONS, 'ENDED', 'ACTIVE').ok).toBe(false);
    expect(checkTransition(MEMBERSHIP_TRANSITIONS, 'INVITED', 'ACTIVE').ok).toBe(false);
  });
});

describe('creator role and slug', () => {
  it('maps organization type to creator role', () => {
    expect(creatorRole('CLUB')).toBe('CLUB_MANAGER');
    expect(creatorRole('ORGANIZER')).toBe('ORGANIZER');
    expect(creatorRole('REGIONAL_FEDERATION')).toBe('FEDERATION_ADMIN');
  });

  it('transliterates russian names', () => {
    expect(slugify('Клуб «Витязь»')).toBe('klub-vityaz');
    expect(slugify('СШ № 1 Самбо-70')).toBe('ssh-1-sambo-70');
    expect(slugify('Ёж')).toBe('ezh');
    expect(slugify('!!')).toMatch(/^[a-z0-9-]{3,}$/);
  });
});
