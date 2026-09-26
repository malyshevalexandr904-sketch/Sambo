// Предпросмотр импорта: нормализация строк, проверка разряда и тренера, дубли в системе и внутри файла.
// Зависимости от БД передаются функциями — логика проверяется unit-тестами.
import {
  type DuplicateCandidate,
  type ImportReport,
  type ImportRowReport,
  normalizeImportRow,
} from '@sde/contracts';
import type { RawRow } from './parse';

export interface ImportLookups {
  rankCodes: ReadonlySet<string>;
  /** Тренер организации по email его аккаунта (действующая работа в организации). */
  coachByEmail: (email: string) => Promise<{ id: string; name: string } | null>;
  duplicates: (person: {
    lastName: string;
    firstName: string;
    birthDate: string;
  }) => Promise<DuplicateCandidate[]>;
}

const key = (d: { lastName: string; firstName: string; birthDate: string }): string =>
  `${d.lastName.toLowerCase().replaceAll('ё', 'е')}|${d.firstName.toLowerCase().replaceAll('ё', 'е')}|${d.birthDate}`;

export async function analyzeRows(rows: RawRow[], lookups: ImportLookups): Promise<ImportReport> {
  const seen = new Map<string, number>();
  const coaches = new Map<string, { id: string; name: string } | null>();
  const report: ImportRowReport[] = [];
  for (const raw of rows) {
    const { data, errors } = normalizeImportRow(raw.values);
    let coach: { id: string; name: string } | null = null;
    let duplicates: DuplicateCandidate[] = [];
    if (data) {
      if (data.sportRankCode && !lookups.rankCodes.has(data.sportRankCode))
        errors.push({ path: 'sportRankCode', code: 'invalid_code' });
      if (data.coachEmail) {
        if (!coaches.has(data.coachEmail))
          coaches.set(data.coachEmail, await lookups.coachByEmail(data.coachEmail));
        coach = coaches.get(data.coachEmail) ?? null;
        if (!coach) errors.push({ path: 'coachEmail', code: 'coach_not_found' });
      }
      const k = key(data);
      const first = seen.get(k);
      if (first !== undefined) errors.push({ path: 'lastName', code: 'duplicate_in_file' });
      else seen.set(k, raw.row);
      if (errors.length === 0) duplicates = await lookups.duplicates(data);
    }
    report.push({
      row: raw.row,
      source: {
        lastName: raw.values.lastName?.trim() ?? '',
        firstName: raw.values.firstName?.trim() ?? '',
        birthDate: raw.values.birthDate?.trim() ?? '',
      },
      data: errors.length === 0 ? data : null,
      errors,
      duplicates,
      coach,
      result: null,
    });
  }
  return {
    totalRows: report.length,
    validRows: report.filter((r) => r.data !== null).length,
    errorRows: report.filter((r) => r.data === null).length,
    duplicateRows: report.filter((r) => r.duplicates.length > 0).length,
    rows: report,
    results: null,
  };
}
