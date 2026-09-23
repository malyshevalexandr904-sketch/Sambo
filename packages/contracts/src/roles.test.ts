import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from './permissions.js';
import { PLATFORM_ROLE_CODES, ROLE_PERMISSIONS } from './roles.js';
import { ERROR_CODES, httpStatusOf } from './errors.js';
import { Email, maskIp, PersonName, Timezone } from './common.js';

describe('role matrix (PERMISSIONS.md, 4)', () => {
  it('SUPER_ADMIN holds every permission directly', () => {
    for (const code of PERMISSION_CODES) expect(ROLE_PERMISSIONS.SUPER_ADMIN[code]).toBe('DIRECT');
  });

  it('only SUPER_ADMIN has platform.settings.manage and role.manage', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === 'SUPER_ADMIN') continue;
      expect(perms['platform.settings.manage']).toBeUndefined();
      expect(perms['role.manage']).toBeUndefined();
    }
  });

  it('PLATFORM_ADMIN never changes competition sports data', () => {
    const pa = ROLE_PERMISSIONS.PLATFORM_ADMIN;
    expect(pa['competition.view']).toBe('DIRECT');
    expect(pa['competition.update']).toBeUndefined();
    expect(pa['result.amend']).toBeUndefined();
  });

  it('encodes policy, inherited and limited marks', () => {
    expect(ROLE_PERMISSIONS.COACH['athlete.update']).toBe('POLICY');
    expect(ROLE_PERMISSIONS.ORGANIZER['competition.publish']).toBe('INHERITED');
    expect(ROLE_PERMISSIONS.REFEREE['competition.view']).toBe('LIMITED');
    expect(ROLE_PERMISSIONS.REFEREE['result.confirm']).toBe('POLICY');
    expect(ROLE_PERMISSIONS.MEDICAL_STAFF['medical.record']).toBe('DIRECT');
    expect(ROLE_PERMISSIONS.SECRETARY['medical.view']).toBeUndefined();
  });

  it('platform roles are SUPER_ADMIN and PLATFORM_ADMIN', () => {
    expect(PLATFORM_ROLE_CODES).toEqual(['SUPER_ADMIN', 'PLATFORM_ADMIN']);
  });
});

describe('errors', () => {
  it('maps categories to HTTP statuses', () => {
    expect(httpStatusOf('VALIDATION_FAILED')).toBe(400);
    expect(httpStatusOf('REFRESH_TOKEN_REUSED')).toBe(401);
    expect(httpStatusOf('CSRF_TOKEN_INVALID')).toBe(403);
    expect(httpStatusOf('VERSION_CONFLICT')).toBe(409);
    expect(httpStatusOf('INVALID_TRANSITION')).toBe(422);
    expect(httpStatusOf('RATE_LIMITED')).toBe(429);
    expect(httpStatusOf('DEPENDENCY_UNAVAILABLE')).toBe(503);
    expect(Object.keys(ERROR_CODES).length).toBeGreaterThan(35);
  });
});

describe('common schemas', () => {
  it('normalizes email', () => {
    expect(Email.parse('  Coach@Example.RU ')).toBe('coach@example.ru');
  });
  it('accepts cyrillic names with ё and hyphen', () => {
    expect(PersonName.parse('Семёнова-Петрова')).toBe('Семёнова-Петрова');
    expect(PersonName.safeParse('<script>').success).toBe(false);
  });
  it('validates IANA timezones', () => {
    expect(Timezone.safeParse('Europe/Moscow').success).toBe(true);
    expect(Timezone.safeParse('Mars/Olympus').success).toBe(false);
  });
  it('masks IPs', () => {
    expect(maskIp('203.0.113.42')).toBe('203.0.113.*');
    expect(maskIp('::ffff:10.1.2.3')).toBe('10.1.2.*');
    expect(maskIp('2001:db8:85a3::8a2e')).toBe('2001:db8:*');
  });
});
