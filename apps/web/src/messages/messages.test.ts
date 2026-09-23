// Проверка словарей в CI (ARCHITECTURE.md, 19): ключи ru и en совпадают, у каждого кода ошибки,
// роли, типа и статуса организации есть перевод.
import {
  ERROR_CODES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  ROLE_CODES,
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
    ];
    expect(required.filter((k) => !all.has(k))).toEqual([]);
  });

  it('keys contain no dots (next-intl uses dots as separators)', () => {
    const bad = keys(ru as Tree).filter((k) => k.split('.').some((part) => part.length === 0));
    expect(bad).toEqual([]);
  });
});
