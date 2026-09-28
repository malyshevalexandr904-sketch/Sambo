// Проверка словарей в CI (ARCHITECTURE.md, 19): ключи ru и en совпадают, у каждого кода ошибки,
// роли, типа и статуса организации, статусов и видов из справочников Phase 3, турниров Phase 4a и допуска,
// прибытия, взвешивания, медицины и уведомлений Phase 4b, жеребьёвки и сеток Phase 5a есть перевод.
import {
  ADMISSION_CHECK_KINDS,
  ADMISSION_CHECK_STATUSES,
  ADMISSION_REASONS,
  ADMISSION_STATUSES,
  AGE_POLICIES,
  APPLICATION_STATUSES,
  CATEGORY_STATUSES,
  CHECK_IN_METHODS,
  CHECK_IN_STATUSES,
  COMPETITION_FORMAT_CODES,
  COMPETITION_LEVELS,
  COMPETITION_STATUSES,
  CONSENT_KINDS,
  DOCUMENT_STATUSES,
  DRAW_STATUSES,
  ELIGIBILITY_REASONS,
  ENTRY_STATUSES,
  ERROR_CODES,
  GUARDIAN_RELATIONS,
  GUARDIAN_VERIFICATION_BASES,
  IMPORT_COLUMNS,
  IMPORT_FILE_ERRORS,
  MEDICAL_STATES,
  NOTIFICATION_TYPES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  PROFILE_STATUSES,
  REQUIREMENT_KINDS,
  ROLE_CODES,
  ROUND_LABELS,
  RULESET_VERSION_STATUSES,
  SEPARATION_KEYS,
  SYSTEM_SETTING_DEFAULTS,
  USER_STATUSES,
  WEIGH_IN_ATTEMPT_KINDS,
  WEIGH_IN_FAILURE_OUTCOMES,
  WEIGH_IN_RESULTS,
  WEIGH_IN_STATUSES,
  WEIGH_IN_WINDOW_KINDS,
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
      ...COMPETITION_STATUSES.map((s) => `competitions.statuses.${s}`),
      ...COMPETITION_STATUSES.map((s) => `tournaments.status.${s}`),
      ...COMPETITION_LEVELS.map((l) => `competitions.levels.${l}`),
      ...CATEGORY_STATUSES.map((s) => `competitions.categoryStatuses.${s}`),
      ...APPLICATION_STATUSES.map((s) => `applications.statuses.${s}`),
      ...ENTRY_STATUSES.map((s) => `applications.entryStatuses.${s}`),
      ...ELIGIBILITY_REASONS.map((r) => `applications.reasons.${r}`),
      ...REQUIREMENT_KINDS.map((k) => `tournaments.requirementKinds.${k}`),
      ...ADMISSION_STATUSES.map((s) => `admission.statuses.${s}`),
      ...ADMISSION_CHECK_KINDS.map((k) => `admission.checkKinds.${k}`),
      ...ADMISSION_CHECK_STATUSES.map((s) => `admission.checkStatuses.${s}`),
      ...ADMISSION_REASONS.map((r) => `admission.reasons.${r}`),
      ...CHECK_IN_STATUSES.map((s) => `checkin.statuses.${s}`),
      ...CHECK_IN_METHODS.map((m) => `checkin.methods.${m}`),
      ...WEIGH_IN_STATUSES.map((s) => `weighin.statuses.${s}`),
      ...WEIGH_IN_ATTEMPT_KINDS.map((k) => `weighin.kinds.${k}`),
      ...WEIGH_IN_RESULTS.map((r) => `weighin.results.${r}`),
      ...WEIGH_IN_WINDOW_KINDS.map((k) => `weighin.windowKinds.${k}`),
      ...WEIGH_IN_FAILURE_OUTCOMES.map((o) => `competitions.outcomes.${o}`),
      ...MEDICAL_STATES.map((s) => `medical.states.${s}`),
      ...DRAW_STATUSES.map((s) => `draws.statuses.${s}`),
      ...COMPETITION_FORMAT_CODES.map((f) => `draws.formats.${f}`),
      ...SEPARATION_KEYS.flatMap((k) => [`draws.create.keys.${k}`, `draws.separation.keys.${k}`]),
      ...ROUND_LABELS.map((l) => `bracket.rounds.${l}`),
      ...NOTIFICATION_TYPES.flatMap((n) => [
        `notifications.types.${n.replace('.', '_')}.title`,
        `notifications.prefs.${n.replace('.', '_')}`,
      ]),
    ];
    expect(required.filter((k) => !all.has(k))).toEqual([]);
  });

  it('keys contain no dots (next-intl uses dots as separators)', () => {
    const bad = keys(ru as Tree).filter((k) => k.split('.').some((part) => part.length === 0));
    expect(bad).toEqual([]);
  });
});
