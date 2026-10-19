// Версии правил расчёта рейтинга (docs/RATING_ARCHITECTURE.md, 4). Параметры проверяются схемой при каждом
// чтении — расчёт не идёт по повреждённым или неизвестным правилам.
import {
  RATING_RULES_SCHEMA_VERSION,
  RatingRuleParametersV1,
  type RatingRuleSetStatus,
} from '@sde/contracts';
import type { RatingRuleSet } from '@sde/db';
import { calculationVersion, type RatingRules } from './rules.js';

/** Код правил рейтинга самбо; версии — sambo-elo@1, @2, … */
export const SAMBO_ELO_CODE = 'sambo-elo';

export interface RatingRuleSetInfo {
  id: string;
  code: string;
  version: number;
  name: string;
  status: RatingRuleSetStatus;
  engineVersion: string;
  /** «{code}@{version}/{engineVersion}» — версия расчёта схватки. */
  calculationVersion: string;
  rules: RatingRules;
}

export function toRuleSetInfo(row: RatingRuleSet): RatingRuleSetInfo {
  if (row.schemaVersion !== RATING_RULES_SCHEMA_VERSION)
    throw new Error(`rating_rule_set ${row.id}: unsupported schema version ${row.schemaVersion}`);
  const parsed = RatingRuleParametersV1.safeParse(row.parameters);
  if (!parsed.success)
    throw new Error(`rating_rule_set ${row.id}: invalid parameters: ${parsed.error.message}`);
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    name: row.name,
    status: row.status,
    engineVersion: row.engineVersion,
    calculationVersion: calculationVersion(row),
    rules: parsed.data,
  };
}
