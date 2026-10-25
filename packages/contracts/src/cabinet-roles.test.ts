import { describe, expect, it } from 'vitest';
import {
  CABINET_ROLE_GRANTS,
  CABINET_ROLES,
  cabinetRoleOf,
  defaultCabinetRole,
  roleActiveIn,
  UNASSIGNED_ROLE_CODES,
} from './cabinet-roles.js';
import { RegisterRequest } from './auth.js';
import { ROLE_CODES } from './roles.js';

describe('роли кабинета', () => {
  it('каждая роль доступа — ровно в одной роли кабинета', () => {
    expect(UNASSIGNED_ROLE_CODES).toEqual([]);
    for (const r of ROLE_CODES) {
      const owners = CABINET_ROLES.filter((c) => CABINET_ROLE_GRANTS[c].includes(r));
      expect(owners, r).toHaveLength(1);
    }
    expect(cabinetRoleOf('CLUB_MANAGER')).toBe('ORGANIZATION_HEAD');
    expect(cabinetRoleOf('ORGANIZER')).toBe('ORGANIZATION_HEAD');
    expect(cabinetRoleOf('SECRETARY')).toBe('REFEREE');
    expect(cabinetRoleOf('CHIEF_REFEREE')).toBe('REFEREE');
    expect(cabinetRoleOf('TOURNAMENT_MANAGER')).toBe('REFEREE');
    expect(cabinetRoleOf('MEDICAL_STAFF')).toBe('MEDICAL');
    expect(cabinetRoleOf('SUPER_ADMIN')).toBe('ADMIN');
  });

  it('роль доступа действует только в своей роли кабинета', () => {
    expect(roleActiveIn('COACH', 'COACH')).toBe(true);
    expect(roleActiveIn('ORGANIZATION_HEAD', 'COACH')).toBe(false);
    expect(roleActiveIn('GUARDIAN', 'CLUB_MANAGER')).toBe(false);
    expect(roleActiveIn(null, 'SUPER_ADMIN')).toBe(false);
  });

  it('по умолчанию — последняя выбранная, если она есть, иначе первая по порядку', () => {
    expect(defaultCabinetRole(['COACH', 'GUARDIAN'], 'GUARDIAN')).toBe('GUARDIAN');
    expect(defaultCabinetRole(['COACH', 'GUARDIAN'], 'REFEREE')).toBe('COACH');
    expect(defaultCabinetRole(['GUARDIAN', 'ADMIN'], null)).toBe('ADMIN');
    expect(defaultCabinetRole([], 'COACH')).toBeNull();
  });

  it('регистрация принимает роль анкеты, но не роль администратора', () => {
    const base = {
      email: 'a@b.ru',
      password: 'Sambo-Dev-2026!',
      displayName: 'А',
      locale: 'ru',
      acceptTerms: true,
      acceptPersonalData: true,
    };
    expect(RegisterRequest.safeParse({ ...base, role: 'COACH' }).success).toBe(true);
    expect(RegisterRequest.safeParse(base).success).toBe(true);
    expect(RegisterRequest.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
  });
});
