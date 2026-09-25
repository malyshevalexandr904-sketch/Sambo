import { describe, expect, it } from 'vitest';
import {
  canSee,
  decide,
  type EffectiveGrants,
  grantablePermissions,
  holdsAnywhere,
  missingPermissionsForRole,
  NOWHERE_SCOPE,
  organizationReach,
  type ResourceScope,
} from './grants';

const base: EffectiveGrants = {
  userId: 'u',
  permissionsVersion: 1,
  platform: [],
  organizations: [],
  competitions: [],
};

const FED = 'fed';
const CLUB = 'club';
const OTHER_CLUB = 'other-club';

const orgScope = (id: string, ancestors: string[], visibleToAll = true): ResourceScope => ({
  kind: 'ORGANIZATION',
  organizationId: id,
  ancestorIds: [id, ...ancestors],
  visibleToAll,
});

const compScope = (organizer: string, ancestors: string[]): ResourceScope => ({
  kind: 'COMPETITION',
  competitionId: 'comp',
  organizerOrganizationId: organizer,
  organizerAncestorIds: [organizer, ...ancestors],
  visibleToAll: false,
});

describe('decide — platform roles', () => {
  it('SUPER_ADMIN is allowed everywhere', () => {
    const g = { ...base, platform: ['SUPER_ADMIN' as const] };
    expect(decide(g, 'platform.settings.manage', { kind: 'PLATFORM' }).allowed).toBe(true);
    expect(decide(g, 'athlete.create', orgScope(CLUB, [FED])).viaPlatform).toBe(true);
    expect(decide(g, 'result.amend', compScope(CLUB, [])).allowed).toBe(true);
  });

  it('PLATFORM_ADMIN cannot change competition sports data', () => {
    const g = { ...base, platform: ['PLATFORM_ADMIN' as const] };
    expect(decide(g, 'user.manage', { kind: 'PLATFORM' }).allowed).toBe(true);
    expect(decide(g, 'competition.view', compScope(CLUB, [])).allowed).toBe(true);
    expect(decide(g, 'competition.update', compScope(CLUB, [])).allowed).toBe(false);
    expect(decide(g, 'role.manage', { kind: 'PLATFORM' }).allowed).toBe(false);
  });

  it('organization roles never grant platform-scoped permissions', () => {
    const g = {
      ...base,
      organizations: [
        { organizationId: FED, organizationStatus: 'ACTIVE' as const, roles: ['FEDERATION_ADMIN' as const] },
      ],
    };
    expect(decide(g, 'organization.approve', { kind: 'PLATFORM' }).allowed).toBe(false);
    expect(decide(g, 'user.view', orgScope(FED, [])).allowed).toBe(false);
  });
});

describe('decide — organization hierarchy (ORG_DESCENDANT)', () => {
  const fa: EffectiveGrants = {
    ...base,
    organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['FEDERATION_ADMIN'] }],
  };

  it('federation admin inherits rights on descendant clubs', () => {
    expect(decide(fa, 'organization.update', orgScope(CLUB, [FED])).allowed).toBe(true);
    expect(decide(fa, 'organization.approve', orgScope(FED, [])).allowed).toBe(true);
  });

  it('but not on organizations outside the subtree', () => {
    expect(decide(fa, 'organization.update', orgScope(OTHER_CLUB, ['other-fed'])).allowed).toBe(false);
  });

  it('club manager rights do not flow down (no inheritance for CLUB_MANAGER)', () => {
    const cm: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['CLUB_MANAGER'] }],
    };
    expect(decide(cm, 'organization.update', orgScope(FED, [])).allowed).toBe(true);
    expect(decide(cm, 'organization.update', orgScope(CLUB, [FED])).allowed).toBe(false);
  });

  it('suspended federation grants nothing to descendants', () => {
    const suspended: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'SUSPENDED', roles: ['FEDERATION_ADMIN'] }],
    };
    expect(decide(suspended, 'organization.update', orgScope(CLUB, [FED])).allowed).toBe(false);
    expect(decide(suspended, 'organization.members.view', orgScope(FED, [])).allowed).toBe(true);
    expect(decide(suspended, 'organization.update', orgScope(FED, [])).allowed).toBe(false);
  });

  it('pending organization members may only fix their own organization', () => {
    const pending: EffectiveGrants = {
      ...base,
      organizations: [
        { organizationId: FED, organizationStatus: 'PENDING_REVIEW', roles: ['FEDERATION_ADMIN'] },
      ],
    };
    expect(decide(pending, 'organization.update', orgScope(FED, [])).allowed).toBe(true);
    expect(decide(pending, 'organization.approve', orgScope(FED, [])).allowed).toBe(false);
    expect(decide(pending, 'organization.update', orgScope(CLUB, [FED])).allowed).toBe(false);
  });
});

describe('decide — competition scope', () => {
  it('ORGANIZER inherits TOURNAMENT_MANAGER rights on own organization competitions (▲)', () => {
    const g: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['ORGANIZER'] }],
    };
    const d = decide(g, 'competition.publish', compScope(CLUB, [FED]));
    expect(d).toEqual({ allowed: true, mode: 'INHERITED', viaPlatform: false });
    expect(decide(g, 'competition.publish', compScope(OTHER_CLUB, [])).allowed).toBe(false);
    expect(decide(g, 'medical.view', compScope(CLUB, [])).allowed).toBe(false);
  });

  it('competition membership grants rights only in that competition', () => {
    const g: EffectiveGrants = { ...base, competitions: [{ competitionId: 'comp', roles: ['REFEREE'] }] };
    expect(decide(g, 'competition.view', compScope(CLUB, [])).mode).toBe('LIMITED');
    expect(decide(g, 'scoring.create', compScope(CLUB, [])).mode).toBe('POLICY');
    expect(decide(g, 'draw.publish', compScope(CLUB, [])).allowed).toBe(false);
  });

  it('federation admin sees descendant competitions read-only', () => {
    const g: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['FEDERATION_ADMIN'] }],
    };
    expect(decide(g, 'competition.view', compScope(CLUB, [FED])).allowed).toBe(true);
    expect(decide(g, 'competition.update', compScope(CLUB, [FED])).allowed).toBe(false);
  });
});

describe('visibility and role granting', () => {
  it('hides inactive organizations from outsiders', () => {
    expect(canSee(base, orgScope(CLUB, [FED], false))).toBe(false);
    expect(canSee(base, orgScope(CLUB, [FED], true))).toBe(true);
    const member: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['COACH'] }],
    };
    expect(canSee(member, orgScope(CLUB, [FED], false))).toBe(true);
  });

  it('club manager can invite a coach but not an organizer', () => {
    const cm: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['CLUB_MANAGER'] }],
    };
    const scope = orgScope(CLUB, [FED]) as Extract<ResourceScope, { kind: 'ORGANIZATION' }>;
    const perms = grantablePermissions(cm, scope);
    expect(missingPermissionsForRole(perms, 'COACH')).toEqual([]);
    expect(missingPermissionsForRole(perms, 'ORGANIZER').length).toBeGreaterThan(0);
  });

  it('federation admin can invite another federation admin, organizer can invite organizer', () => {
    const fa: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['FEDERATION_ADMIN'] }],
    };
    const scope = orgScope(FED, []) as Extract<ResourceScope, { kind: 'ORGANIZATION' }>;
    expect(missingPermissionsForRole(grantablePermissions(fa, scope), 'FEDERATION_ADMIN')).toEqual([]);
    const org: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['ORGANIZER'] }],
    };
    const clubScope = orgScope(CLUB, []) as Extract<ResourceScope, { kind: 'ORGANIZATION' }>;
    expect(missingPermissionsForRole(grantablePermissions(org, clubScope), 'ORGANIZER')).toEqual([]);
  });
});

describe('organization reach for list filters (PERMISSIONS.md, 6)', () => {
  it('lists organizations with the grant mode and inheritance to descendants', () => {
    const g: EffectiveGrants = {
      ...base,
      organizations: [
        { organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['COACH'] },
        { organizationId: FED, organizationStatus: 'ACTIVE', roles: ['FEDERATION_ADMIN'] },
        { organizationId: OTHER_CLUB, organizationStatus: 'SUSPENDED', roles: ['CLUB_MANAGER'] },
      ],
    };
    expect(organizationReach(g, 'athlete.view')).toEqual({
      platform: false,
      organizations: [
        { organizationId: CLUB, mode: 'DIRECT', withDescendants: false },
        { organizationId: FED, mode: 'DIRECT', withDescendants: true },
      ],
    });
    expect(organizationReach(g, 'athlete.update').organizations).toEqual([
      { organizationId: CLUB, mode: 'POLICY', withDescendants: false },
    ]);
    // ▲ у организатора — только на турнирах, в организациях списка нет.
    const org: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['ORGANIZER'] }],
    };
    expect(organizationReach(org, 'document.view').organizations).toEqual([]);
  });

  it('holds a permission anywhere: organization, competition or platform', () => {
    const fa: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: FED, organizationStatus: 'ACTIVE', roles: ['FEDERATION_ADMIN'] }],
    };
    expect(holdsAnywhere(fa, 'referee.manage')).toBe(true);
    expect(holdsAnywhere(base, 'referee.manage')).toBe(false);
    const secretary: EffectiveGrants = {
      ...base,
      competitions: [{ competitionId: 'c1', roles: ['SECRETARY'] }],
    };
    expect(holdsAnywhere(secretary, 'document.verify')).toBe(true);
    const pa: EffectiveGrants = { ...base, platform: ['PLATFORM_ADMIN'] };
    expect(organizationReach(pa, 'athlete.view').platform).toBe(true);
  });

  it('a resource without organizations is visible only to the platform', () => {
    const coach: EffectiveGrants = {
      ...base,
      organizations: [{ organizationId: CLUB, organizationStatus: 'ACTIVE', roles: ['COACH'] }],
    };
    expect(canSee(coach, NOWHERE_SCOPE)).toBe(false);
    expect(decide(coach, 'athlete.view', NOWHERE_SCOPE).allowed).toBe(false);
    expect(decide({ ...base, platform: ['SUPER_ADMIN'] }, 'athlete.view', NOWHERE_SCOPE).allowed).toBe(true);
  });
});
