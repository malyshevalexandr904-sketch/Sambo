// Генерирует идемпотентную миграцию данных: каталог прав и ролей из packages/contracts
// и справочники из reference-data.ts (DATABASE.md, 10; PERMISSIONS.md, 1).
//
//   pnpm --filter @sde/db exec tsx scripts/generate-data-migration.ts <migration_name> [--access-only]
//
// Каталог прав меняется в коде (contracts) → генерируется новая миграция → ревью SQL.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CODES, PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS, ROLES, permissionModule } from '@sde/contracts';
import { uuidv7 } from '../src/uuid';
import { COUNTRIES, DISCIPLINES, DOCUMENT_TYPES, REFEREE_CATEGORIES, RU_REGIONS, SPORT_RANKS } from './reference-data';

const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;

function accessSql(): string {
  const perms = PERMISSION_CODES.map((code) => {
    const def = PERMISSIONS[code];
    const scopes = `ARRAY[${def.scopes.map(q).join(', ')}]::"RoleScope"[]`;
    return `  (${q(code)}, ${q(permissionModule(code))}, ${q(def.description)}, ${scopes})`;
  });
  const roles = ROLE_CODES.map(
    (code) => `  (${q(uuidv7())}::uuid, ${q(code)}, ${q(ROLES[code].scope)}::"RoleScope", true, ${q(ROLES[code].nameKey)})`,
  );
  const grants = ROLE_CODES.flatMap((role) =>
    Object.entries(ROLE_PERMISSIONS[role]).map(([perm, mode]) => `  (${q(role)}, ${q(perm)}, ${q(mode)})`),
  );
  return `-- Каталог permissions (packages/contracts/src/permissions.ts)
INSERT INTO "permission" ("code", "module", "description", "scopes") VALUES
${perms.join(',\n')}
ON CONFLICT ("code") DO UPDATE SET "module" = EXCLUDED."module", "description" = EXCLUDED."description", "scopes" = EXCLUDED."scopes";

DELETE FROM "permission" WHERE "code" NOT IN (${PERMISSION_CODES.map(q).join(', ')});

-- Системные роли (packages/contracts/src/roles.ts)
INSERT INTO "role" ("id", "code", "scope", "is_system", "name_key") VALUES
${roles.join(',\n')}
ON CONFLICT ("code") DO UPDATE SET "scope" = EXCLUDED."scope", "is_system" = true, "name_key" = EXCLUDED."name_key";

-- Матрица «роль × permission» (PERMISSIONS.md, 4) — заменяется целиком для системных ролей
DELETE FROM "role_permission" rp USING "role" r WHERE rp."role_id" = r."id" AND r."is_system";

INSERT INTO "role_permission" ("role_id", "permission_code", "mode")
SELECT r."id", v.perm, v.mode::"GrantMode"
FROM (VALUES
${grants.join(',\n')}
) AS v(role, perm, mode)
JOIN "role" r ON r."code" = v.role;

-- Права ролей изменились → кэш эффективных прав всех пользователей устарел
UPDATE "user" SET "permissions_version" = "permissions_version" + 1;
`;
}

function referenceSql(): string {
  const countries = COUNTRIES.map(([c, ru, en]) => `  (${q(c)}, ${q(ru)}, ${q(en)})`);
  const regions = RU_REGIONS.map(([c, ru, en]) => `  (${q(uuidv7())}::uuid, 'RU', ${q(c)}, ${q(ru)}, ${q(en)})`);
  const ranks = SPORT_RANKS.map(([c, ru, en, o]) => `  (${q(c)}, ${q(ru)}, ${q(en)}, ${o})`);
  const refs = REFEREE_CATEGORIES.map(([c, ru, en, o]) => `  (${q(c)}, ${q(ru)}, ${q(en)}, ${o})`);
  const disciplines = DISCIPLINES.map(([c, ru, en]) => `  (${q(c)}, ${q(ru)}, ${q(en)})`);
  const docs = DOCUMENT_TYPES.map(
    ([c, ru, en, s, mime, max, days]) =>
      `  (${q(c)}, ${q(ru)}, ${q(en)}, ${q(s)}::"Sensitivity", ${q(mime)}, ${max}, ${days})`,
  );
  return `-- Справочники (packages/db/scripts/reference-data.ts). Существующие записи не перезаписываются.
INSERT INTO "country" ("code", "name_ru", "name_en") VALUES
${countries.join(',\n')}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "region" ("id", "country_code", "code", "name_ru", "name_en") VALUES
${regions.join(',\n')}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "sport_rank" ("code", "name_ru", "name_en", "rank_order") VALUES
${ranks.join(',\n')}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "referee_category" ("code", "name_ru", "name_en", "rank_order") VALUES
${refs.join(',\n')}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "discipline" ("code", "name_ru", "name_en") VALUES
${disciplines.join(',\n')}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "document_type" ("code", "name_ru", "name_en", "sensitivity", "allowed_mime", "max_size_bytes", "retention_days") VALUES
${docs.join(',\n')}
ON CONFLICT ("code") DO NOTHING;
`;
}

const name = process.argv[2];
if (!name || !/^\d{14}_[a-z0-9_]+$/.test(name)) {
  throw new Error('Usage: generate-data-migration.ts <yyyymmddhhmmss_name> [--access-only]');
}
const accessOnly = process.argv.includes('--access-only');
const dir = path.join(__dirname, '..', 'prisma', 'migrations', name);
mkdirSync(dir, { recursive: true });
const header = `-- Миграция данных, сгенерирована scripts/generate-data-migration.ts. Идемпотентна. Не править вручную.\n\n`;
writeFileSync(path.join(dir, 'migration.sql'), header + accessSql() + (accessOnly ? '' : '\n' + referenceSql()));
process.stdout.write(`Written ${path.join(dir, 'migration.sql')}\n`);
