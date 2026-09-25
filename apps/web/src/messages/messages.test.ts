// Проверка словарей в CI (ARCHITECTURE.md, 19): ключи ru и en совпадают, у каждого кода ошибки,
// роли, типа и статуса организации, статусов и видов из справочников Phase 3 есть перевод.
import {
  AGE_POLICIES,
  CONSENT_KINDS,
  DOCUMENT_STATUSES,
  ERROR_CODES,
  GUARDIAN_RELATIONS,
  GUARDIAN_VERIFICATION_BASES,
  IMPORT_COLUMNS,
  IMPORT_FILE_ERRORS,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  PROFILE_STATUSES,
  ROLE_CODES,
  RULESET_VERSION_STATUSES,
  SYSTEM_SETTING_DEFAULTS,
  USER_STATUSES,
} from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

type Tree = { [k: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe('i18n dictionaries', () => {
  it('ru and en have the same keys', () => {
    expect(keys(en as Tree).sort()).toEqual(keys(ru as Tree).sort());
  });

  it('translate every error code, role, organization type and status', () => {
    const all = new Set(keys(ru));
    const required = [
      ...Object.keys(ERROR_CODES).map((c) => `errors.${c}`),
      ...ROLE_CODES.map((r) => `roles.${r}`),
      ...ORGANIZATION_TYPES.map((x) => `orgTypes.${x}`),
      ...[...ORGANIZATION_STATUSES, ...USER_STATUSES].map((s) => `statuses.${s}`),
      ...Object.keys(SYSTEM_SETTING_DEFAULTS).map((k) => `settings.keys.${k.replaceAll('.', '_')}`),
      ...PROFILE_STATUSES.map((s) => `statuses.${s}`),
      ...DOCUMENT_STATUSES.map((s) => `documents.statuses.${s}`),
      ...CONSENT_KINDS.map((k) => `consents.kinds.${k}`),
      ...GUARDIAN_RELATIONS.map((r) => `guardians.relations.${r}`),
      ...GUARDIAN_VERIFICATION_BASES.map((b) => `guardians.bases.${b}`),
      ...IMPORT_FILE_ERRORS.map((e) => `imports.fileErrors.${e}`),
      ...IMPORT_COLUMNS.map((c) => `imports.columns.${c}`),
      ...AGE_POLICIES.map((p) => `catalog.policies.${p}`),
      ...RULESET_VERSION_STATUSES.map((s) => `rulesets.statuses.${s}`),
    ];
    expect(required.filter((k) => !all.has(k))).toEqual([]);
  });

  it('keys contain no dots (next-intl uses dots as separators)', () => {
    const bad = keys(ru as Tree).filter((k) => k.split('.').some((part) => part.length === 0));
    expect(bad).toEqual([]);
  });
});
