// Роль в кабинете (0.13.0): человек с несколькими ролями работает в одной выбранной — права на сервере, меню и
// стартовая страница действуют только для неё. Выбор хранится на сессию входа и меняется переключателем в кабинете.
// Это не роль доступа: роли доступа (платформа, организация, турнир) и политики отношений группируются по ролям
// кабинета, и в выбранной действуют только свои.
import { z } from 'zod';
import { ROLE_CODES, type RoleCode } from './roles.js';

/** Порядок — и порядок в переключателе, и выбор по умолчанию, если последняя выбранная роль недоступна. */
export const CABINET_ROLES = [
  'ADMIN',
  'ORGANIZATION_HEAD',
  'TOURNAMENT_STAFF',
  'REFEREE',
  'MEDICAL',
  'COACH',
  'ATHLETE',
  'GUARDIAN',
] as const;
export type CabinetRole = (typeof CABINET_ROLES)[number];

export const isCabinetRole = (v: unknown): v is CabinetRole =>
  typeof v === 'string' && (CABINET_ROLES as readonly string[]).includes(v);

/**
 * Роли доступа, которые действуют в роли кабинета. Каждая роль доступа — ровно в одной роли кабинета.
 * Спортсмен (политика SELF) и представитель (GUARDIAN) — связи, а не роли доступа: у них свои проверки.
 */
export const CABINET_ROLE_GRANTS: Record<CabinetRole, readonly RoleCode[]> = {
  ADMIN: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  ORGANIZATION_HEAD: ['FEDERATION_ADMIN', 'ORGANIZER', 'CLUB_MANAGER'],
  TOURNAMENT_STAFF: ['TOURNAMENT_MANAGER', 'SECRETARY'],
  REFEREE: ['CHIEF_REFEREE', 'REFEREE'],
  MEDICAL: ['MEDICAL_STAFF'],
  COACH: ['COACH'],
  ATHLETE: [],
  GUARDIAN: [],
};

const BY_ROLE_CODE = new Map<RoleCode, CabinetRole>(
  CABINET_ROLES.flatMap((c) => CABINET_ROLE_GRANTS[c].map((r) => [r, c] as const)),
);

/** Роль кабинета, в которой действует роль доступа. */
export function cabinetRoleOf(role: RoleCode): CabinetRole {
  const c = BY_ROLE_CODE.get(role);
  if (!c) throw new Error(`Role ${role} has no cabinet role`);
  return c;
}

/** Роль доступа действует в выбранной роли кабинета. Без выбранной роли не действует ни одна. */
export const roleActiveIn = (active: CabinetRole | null, role: RoleCode): boolean =>
  active !== null && CABINET_ROLE_GRANTS[active].includes(role);

/** Все роли доступа распределены: проверяется тестом контрактов. */
export const UNASSIGNED_ROLE_CODES = ROLE_CODES.filter((r) => !BY_ROLE_CODE.has(r));

/**
 * Роль по умолчанию: последняя выбранная (или выбранная при регистрации), если она есть у пользователя, иначе
 * первая доступная по порядку CABINET_ROLES. Нет ни одной — null.
 */
export function defaultCabinetRole(
  available: readonly CabinetRole[],
  preferred: CabinetRole | null,
): CabinetRole | null {
  if (preferred && available.includes(preferred)) return preferred;
  return CABINET_ROLES.find((r) => available.includes(r)) ?? null;
}

export const SelectCabinetRoleRequest = z.object({ role: z.enum(CABINET_ROLES) });
export type SelectCabinetRoleRequest = z.infer<typeof SelectCabinetRoleRequest>;
