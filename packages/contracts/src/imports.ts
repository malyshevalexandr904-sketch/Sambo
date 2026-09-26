// Импорт спортсменов из CSV/XLSX (API.md, 4.4; G-14). Нормализация строк общая для worker (разбор)
// и api (повторная проверка при фиксации), поэтому живёт здесь.
import { z } from 'zod';
import { Email, LocalDate, PersonName, Uuid } from './common.js';
import type { FieldError } from './errors.js';
import type { DuplicateCandidate } from './athletes.js';
import { athleteBirthDateInRange, type Gender } from './people.js';

export const IMPORT_COLUMNS = [
  'lastName',
  'firstName',
  'middleName',
  'birthDate',
  'gender',
  'sportRankCode',
  'rankAssignedAt',
  'rankOrderRef',
  'coachEmail',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_REQUIRED_COLUMNS: readonly ImportColumn[] = [
  'lastName',
  'firstName',
  'birthDate',
  'gender',
];

/** Заголовки на русском, как их пишут в Excel. Сравнение — без регистра, «ё» = «е». */
export const IMPORT_HEADER_ALIASES: Record<string, ImportColumn> = {
  фамилия: 'lastName',
  имя: 'firstName',
  отчество: 'middleName',
  'дата рождения': 'birthDate',
  пол: 'gender',
  разряд: 'sportRankCode',
  'код разряда': 'sportRankCode',
  'дата присвоения': 'rankAssignedAt',
  'дата присвоения разряда': 'rankAssignedAt',
  приказ: 'rankOrderRef',
  'номер приказа': 'rankOrderRef',
  'email тренера': 'coachEmail',
  'почта тренера': 'coachEmail',
};

export const IMPORT_MAX_ROWS = 1000;

export const IMPORT_JOB_STATUSES = ['PENDING', 'PARSED', 'COMMITTED', 'FAILED'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/** Ошибки файла целиком (ImportJob.errorCode). */
export const IMPORT_FILE_ERRORS = [
  'FILE_UNREADABLE',
  'EMPTY_FILE',
  'MISSING_COLUMNS',
  'TOO_MANY_ROWS',
] as const;
export type ImportFileError = (typeof IMPORT_FILE_ERRORS)[number];

export function importColumnFor(header: string): ImportColumn | null {
  const h = header.trim().replace(/^\uFEFF/, '');
  if ((IMPORT_COLUMNS as readonly string[]).includes(h)) return h as ImportColumn;
  return IMPORT_HEADER_ALIASES[h.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ')] ?? null;
}

export interface ImportRowData {
  lastName: string;
  firstName: string;
  middleName?: string;
  birthDate: string;
  gender: Gender;
  sportRankCode?: string;
  rankAssignedAt?: string;
  rankOrderRef?: string;
  coachEmail?: string;
}

const GENDER_VALUES: Record<string, Gender> = {
  male: 'MALE',
  m: 'MALE',
  м: 'MALE',
  муж: 'MALE',
  мужской: 'MALE',
  female: 'FEMALE',
  f: 'FEMALE',
  ж: 'FEMALE',
  жен: 'FEMALE',
  женский: 'FEMALE',
};

/** Дата из файла: 2012-05-17, 17.05.2012 или 17/05/2012. */
export function normalizeImportDate(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const ru = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : ru ? [ru[3], ru[2], ru[1]] : [];
  if (!y || !m || !d) return null;
  const out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return LocalDate.safeParse(out).success ? out : null;
}

const RowSchema = z.object({
  lastName: PersonName.optional(),
  firstName: PersonName.optional(),
  middleName: PersonName.optional(),
  sportRankCode: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/, { error: 'invalid_code' })
    .optional(),
  rankOrderRef: z.string().trim().max(100).optional(),
  coachEmail: Email.optional(),
});

/** Нормализует и проверяет одну строку файла. Бизнес-проверки (разряд, тренер, дубли) — отдельно. */
export function normalizeImportRow(raw: Partial<Record<ImportColumn, string>>): {
  data: ImportRowData | null;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];
  const text = (c: ImportColumn): string | undefined => {
    const v = raw[c]?.trim();
    return v ? v : undefined;
  };
  for (const c of ['lastName', 'firstName'] as const)
    if (!text(c)) errors.push({ path: c, code: 'required' });
  const base = RowSchema.safeParse({
    lastName: text('lastName'),
    firstName: text('firstName'),
    middleName: text('middleName'),
    sportRankCode: text('sportRankCode')?.toUpperCase(),
    rankOrderRef: text('rankOrderRef'),
    coachEmail: text('coachEmail'),
  });
  if (!base.success) {
    for (const i of base.error.issues) errors.push({ path: i.path.map(String).join('.'), code: i.message });
  }
  const birthRaw = text('birthDate');
  const birthDate = birthRaw ? normalizeImportDate(birthRaw) : null;
  if (!birthRaw) errors.push({ path: 'birthDate', code: 'required' });
  else if (!birthDate) errors.push({ path: 'birthDate', code: 'invalid_date' });
  else if (!athleteBirthDateInRange(birthDate))
    errors.push({ path: 'birthDate', code: 'birth_date_out_of_range' });

  const genderRaw = text('gender');
  const gender = genderRaw ? GENDER_VALUES[genderRaw.toLowerCase().replace(/\.$/, '')] : undefined;
  if (!genderRaw) errors.push({ path: 'gender', code: 'required' });
  else if (!gender) errors.push({ path: 'gender', code: 'invalid_gender' });

  const rankAtRaw = text('rankAssignedAt');
  const rankAssignedAt = rankAtRaw ? normalizeImportDate(rankAtRaw) : undefined;
  if (rankAtRaw && !rankAssignedAt) errors.push({ path: 'rankAssignedAt', code: 'invalid_date' });
  if (text('sportRankCode') && !rankAtRaw) errors.push({ path: 'rankAssignedAt', code: 'required' });
  if (rankAtRaw && !text('sportRankCode')) errors.push({ path: 'sportRankCode', code: 'required' });

  if (errors.length > 0 || !base.success || !birthDate || !gender) return { data: null, errors };
  const d = base.data;
  if (!d.lastName || !d.firstName) return { data: null, errors };
  return {
    data: {
      lastName: d.lastName,
      firstName: d.firstName,
      ...(d.middleName ? { middleName: d.middleName } : {}),
      birthDate,
      gender,
      ...(d.sportRankCode ? { sportRankCode: d.sportRankCode } : {}),
      ...(rankAssignedAt ? { rankAssignedAt } : {}),
      ...(d.rankOrderRef ? { rankOrderRef: d.rankOrderRef } : {}),
      ...(d.coachEmail ? { coachEmail: d.coachEmail } : {}),
    },
    errors,
  };
}

export const ImportCreate = z.object({ organizationId: Uuid, fileId: Uuid });
export type ImportCreate = z.infer<typeof ImportCreate>;

export const IMPORT_ACTIONS = ['CREATE', 'SKIP', 'LINK'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const ImportCommitRequest = z.object({
  rows: z
    .array(
      z
        .object({
          row: z
            .number()
            .int()
            .min(1)
            .max(IMPORT_MAX_ROWS + 1),
          action: z.enum(IMPORT_ACTIONS),
          athleteId: Uuid.optional(),
        })
        .refine((r) => r.action !== 'LINK' || r.athleteId !== undefined, {
          error: 'required',
          path: ['athleteId'],
        }),
    )
    .min(1)
    .max(IMPORT_MAX_ROWS),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequest>;

export interface ImportRowResult {
  action: ImportAction;
  athleteId: string | null;
  /** Код ошибки из каталога API, если строку не удалось применить. */
  error: string | null;
}

export interface ImportRowReport {
  /** Номер строки файла (заголовок — строка 1). */
  row: number;
  /** Как строка записана в файле — чтобы узнать строку с ошибкой (в отчётах до 0.3.1 поля нет). */
  source?: { lastName: string; firstName: string; birthDate: string };
  data: ImportRowData | null;
  errors: FieldError[];
  duplicates: DuplicateCandidate[];
  coach: { id: string; name: string } | null;
  result: ImportRowResult | null;
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  rows: ImportRowReport[];
  results: { created: number; linked: number; skipped: number; failed: number } | null;
}

export interface ImportJobDto {
  id: string;
  organizationId: string;
  status: ImportJobStatus;
  fileName: string;
  errorCode: ImportFileError | null;
  report: ImportReport | null;
  createdAt: string;
  parsedAt: string | null;
  completedAt: string | null;
}
