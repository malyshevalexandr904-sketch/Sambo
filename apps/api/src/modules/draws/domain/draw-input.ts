// Вход жеребьёвки (ARCHITECTURE.md, 14.5, шаг 1; ADR-11): допущенные участия в каноническом порядке (по entryId),
// посев, ключи разведения, формат и версия алгоритма. Вход сериализуется канонически, inputHash = sha256(вход).
// Во входе только идентификаторы и номера посева — без ПДн: он хранится в Draw.input и попадает в журнал узла.
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type CompetitionFormatCode,
  SEPARATION_KEYS,
  type SeparationKey,
} from '@sde/contracts';

/** Версия алгоритма жеребьёвки: меняется при любом изменении результата при том же входе и seed. */
export const DRAW_ALGORITHM_VERSION = 'draw-v1';

export { SEPARATION_KEYS, type SeparationKey };

export interface DrawParticipant {
  entryId: string;
  /** Команда, за которую выступает спортсмен: организация представительства или клуб. */
  organizationKey: string | null;
  /** Регион представительства или регион спортсмена. */
  regionKey: string | null;
  seedNumber: number | null;
}

export interface DrawInput {
  algorithmVersion: string;
  format: CompetitionFormatCode;
  /** Ключи разведения в порядке приоритета. */
  separation: SeparationKey[];
  participants: DrawParticipant[];
}

export function canonicalDrawInput(input: {
  format: CompetitionFormatCode;
  separation: readonly SeparationKey[];
  participants: readonly DrawParticipant[];
  algorithmVersion?: string;
}): DrawInput {
  // Порядок ключей — приоритет разведения: сохраняется как задан, повторы отбрасываются.
  const separation = input.separation.filter(
    (k, i) => SEPARATION_KEYS.includes(k) && input.separation.indexOf(k) === i,
  );
  return {
    algorithmVersion: input.algorithmVersion ?? DRAW_ALGORITHM_VERSION,
    format: input.format,
    separation,
    participants: [...input.participants]
      .map((p) => ({
        entryId: p.entryId,
        organizationKey: p.organizationKey,
        regionKey: p.regionKey,
        seedNumber: p.seedNumber,
      }))
      .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0)),
  };
}

export function drawInputHash(input: DrawInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** Ошибка входа: коды — пути полей запроса (VALIDATION_FAILED). */
export interface InputIssue {
  path: string;
  code: string;
}

/**
 * Проверка посева: номера различны, от 1 до числа участников, участник посеян один раз и допущен.
 * Посев вне допущенных участий — ошибка, а не молчаливый пропуск.
 */
export function seedingIssues(
  seeding: readonly { entryId: string; seedNumber: number }[],
  admittedEntryIds: ReadonlySet<string>,
): InputIssue[] {
  const issues: InputIssue[] = [];
  const entries = new Set<string>();
  const numbers = new Set<number>();
  seeding.forEach((s, i) => {
    if (!admittedEntryIds.has(s.entryId)) issues.push({ path: `seeding.${i}.entryId`, code: 'not_admitted' });
    if (entries.has(s.entryId)) issues.push({ path: `seeding.${i}.entryId`, code: 'duplicate' });
    if (numbers.has(s.seedNumber)) issues.push({ path: `seeding.${i}.seedNumber`, code: 'duplicate' });
    if (s.seedNumber > admittedEntryIds.size)
      issues.push({ path: `seeding.${i}.seedNumber`, code: 'out_of_range' });
    entries.add(s.entryId);
    numbers.add(s.seedNumber);
  });
  return issues;
}
