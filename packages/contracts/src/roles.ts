// Роли и матрица «роль × permission» (PERMISSIONS.md, 2 и 4).
// Матрица записана построчно в том же порядке столбцов, что и в документе, чтобы её было легко сверять.
import { PERMISSION_CODES, type PermissionCode, type PermissionScope } from './permissions.js';

export const ROLE_CODES = [
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'FEDERATION_ADMIN',
  'ORGANIZER',
  'TOURNAMENT_MANAGER',
  'SECRETARY',
  'CHIEF_REFEREE',
  'REFEREE',
  'MEDICAL_STAFF',
  'COACH',
  'CLUB_MANAGER',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDef {
  scope: PermissionScope;
  /** Организационные права действуют и на все дочерние организации (ORG_DESCENDANT). */
  inheritsToDescendants: boolean;
  /** Обязателен TOTP (ARCHITECTURE.md, 6). */
  requiresTotp: boolean;
  nameKey: string;
}

export const ROLES: Record<RoleCode, RoleDef> = {
  SUPER_ADMIN: {
    scope: 'PLATFORM',
    inheritsToDescendants: false,
    requiresTotp: true,
    nameKey: 'roles.SUPER_ADMIN',
  },
  PLATFORM_ADMIN: {
    scope: 'PLATFORM',
    inheritsToDescendants: false,
    requiresTotp: true,
    nameKey: 'roles.PLATFORM_ADMIN',
  },
  FEDERATION_ADMIN: {
    scope: 'ORGANIZATION',
    inheritsToDescendants: true,
    requiresTotp: false,
    nameKey: 'roles.FEDERATION_ADMIN',
  },
  ORGANIZER: {
    scope: 'ORGANIZATION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.ORGANIZER',
  },
  TOURNAMENT_MANAGER: {
    scope: 'COMPETITION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.TOURNAMENT_MANAGER',
  },
  SECRETARY: {
    scope: 'COMPETITION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.SECRETARY',
  },
  CHIEF_REFEREE: {
    scope: 'COMPETITION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.CHIEF_REFEREE',
  },
  REFEREE: {
    scope: 'COMPETITION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.REFEREE',
  },
  MEDICAL_STAFF: {
    scope: 'COMPETITION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.MEDICAL_STAFF',
  },
  COACH: { scope: 'ORGANIZATION', inheritsToDescendants: false, requiresTotp: false, nameKey: 'roles.COACH' },
  CLUB_MANAGER: {
    scope: 'ORGANIZATION',
    inheritsToDescendants: false,
    requiresTotp: false,
    nameKey: 'roles.CLUB_MANAGER',
  },
};

export const PLATFORM_ROLE_CODES = ROLE_CODES.filter((r) => ROLES[r].scope === 'PLATFORM');
export const ORGANIZATION_ROLE_CODES = ROLE_CODES.filter((r) => ROLES[r].scope === 'ORGANIZATION');
export const COMPETITION_ROLE_CODES = ROLE_CODES.filter((r) => ROLES[r].scope === 'COMPETITION');

/**
 * Режим выдачи права ролью:
 * - DIRECT (●) — в области роли;
 * - POLICY (◐) — только для объектов, прошедших политику отношений (PERMISSIONS.md, 5);
 * - INHERITED (▲) — организатор на турнирах своей организации (ORGANIZER_INHERIT);
 * - LIMITED (○) — чтение ограниченного набора данных.
 */
export type GrantMode = 'DIRECT' | 'POLICY' | 'INHERITED' | 'LIMITED';

const MARKS: Record<string, GrantMode | null> = {
  x: 'DIRECT',
  p: 'POLICY',
  i: 'INHERITED',
  r: 'LIMITED',
  '.': null,
};

// Столбцы: SA PA FA ORG TM SEC CR REF MED COA CM
const COLUMNS: readonly RoleCode[] = [
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'FEDERATION_ADMIN',
  'ORGANIZER',
  'TOURNAMENT_MANAGER',
  'SECRETARY',
  'CHIEF_REFEREE',
  'REFEREE',
  'MEDICAL_STAFF',
  'COACH',
  'CLUB_MANAGER',
];

// prettier-ignore
const MATRIX: Record<PermissionCode, string> = {
  //                               SA PA FA ORG TM SEC CR REF MED COA CM
  'platform.settings.manage':     'x..........',
  'user.view':                    'xx.........',
  'user.manage':                  'xx.........',
  'role.manage':                  'x..........',
  'dictionary.manage':            'xx.........',
  'consent_template.manage':      'xx.........',
  'athlete.merge':                'xx.........',
  'audit.view':                   'xx.ix.x....',
  'organization.approve':         'xxx........',
  'organization.create_child':    'x.x........',
  'organization.update':          'xxxx......x',
  'organization.members.view':    'xxxx......x',
  'organization.members.manage':  'xxx.......x',
  'athlete.view':                 'xxx......xx',
  'athlete.create':               'x........xx',
  'athlete.update':               'x........px',
  'athlete.archive':              'x.........x',
  'athlete.import':               'x.........x',
  'guardian.manage':              'x........px',
  'consent.record':               'x........px',
  'coach.manage':                 'x.........x',
  'referee.manage':               'x.x........',
  'document.upload':              'x........xx',
  'document.view':                'x..ixx...px',
  'document.verify':              'x..ixx.....',
  'category.manage':              'xxxx.......',
  'ruleset.manage':               'xxxx.......',
  'venue.manage':                 'x.xx.......',
  'competition.create':           'x.xx.......',
  'registration.create':          'x........xx',
  'ranking.manage':               'x.x........',
  'competition.view':             'xxxixxxrr..',
  'competition.update':           'x..ix......',
  'competition.delete':           'x..ix......',
  'competition.publish':          'x..ix......',
  'competition.transition':       'x..ix......',
  'competition.members.manage':   'x..ix......',
  'competition_category.manage':  'x..ix......',
  'category.merge':               'x..ix......',
  'registration.view':            'x..ixx.....',
  'registration.approve':         'x..ixx.....',
  'registration.reject':          'x..ixx.....',
  'registration.return':          'x..ixx.....',
  'registration.export':          'x..ixx.....',
  'entry.withdraw':               'x..ix......',
  'entry.transfer':               'x..ixx.....',
  'admission.view':               'x..ixxx.x..',
  'admission.override':           'x..ix......',
  'checkin.view':                 'x..ixx.....',
  'checkin.perform':              'x..ixx.....',
  'weighin.manage':               'x..ix......',
  'weighin.record':               'x..ixx.....',
  'weighin.view':                 'x..ixxx....',
  'medical.view':                 'x.......x..',
  'medical.record':               'x.......x..',
  'draw.create':                  'x..ixxx....',
  'draw.publish':                 'x..ix.x....',
  'draw.republish':               'x.....x....',
  'mat.manage':                   'x..ix......',
  'schedule.manage':              'x..ixx.....',
  'schedule.publish':             'x..ix......',
  'mat_assignment.manage':        'x..ix.x....',
  'match.create':                 'x..ixx.....',
  'match.update':                 'x..ixxxp...',
  'match.start':                  'x.....xp...',
  'match.finish':                 'x.....xp...',
  'match.cancel':                 'x..ix.x....',
  'scoring.create':               'x.....xp...',
  'scoring.update':               'x.....xp...',
  'result.confirm':               'x.....xp...',
  'result.amend':                 'x.....x....',
  'result.publish':               'x..ix.x....',
  'team_standing.publish':        'x..ix......',
  'export.create':                'x..ixxx....',
  'notification.announce':        'x..ix......',
  'venue_node.manage':            'x..ix......',
  'write_lease.recover':          'x..ix......',
};

export type RolePermissionMap = Record<RoleCode, Partial<Record<PermissionCode, GrantMode>>>;

function buildRolePermissions(): RolePermissionMap {
  const result = Object.fromEntries(ROLE_CODES.map((r) => [r, {}])) as RolePermissionMap;
  for (const code of PERMISSION_CODES) {
    const row = MATRIX[code];
    if (row.length !== COLUMNS.length) throw new Error(`Matrix row for ${code} has wrong length`);
    COLUMNS.forEach((role, i) => {
      const mode = MARKS[row[i] ?? '.'];
      if (mode === undefined) throw new Error(`Unknown mark in matrix row ${code}`);
      if (mode) result[role][code] = mode;
    });
  }
  return result;
}

export const ROLE_PERMISSIONS: RolePermissionMap = buildRolePermissions();

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}
