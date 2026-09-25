// Общие запросы к людям для api и worker (проверка дублей G-08). Модуль-владелец данных — `people` в api;
// worker использует тот же запрос при разборе файла импорта, чтобы кандидаты совпадали.
import type { DuplicateCandidate } from '@sde/contracts';
import { Prisma } from '../generated/client/index.js';

/** Нормализация имени как у генерируемых колонок `*_norm` (DATABASE.md, 1.4). */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replaceAll('ё', 'е');
}

interface QueryClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Prisma.PrismaPromise<T>;
}

interface Row {
  athlete_id: string;
  last_name: string;
  first_name: string;
  birth_year: number;
  club_short_name: string | null;
  region_name_ru: string | null;
  region_name_en: string | null;
  sim: number;
}

/** Порог похожести ФИО при совпадающей дате рождения (pg_trgm). */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.45;

/**
 * Кандидаты-дубли спортсмена: та же дата рождения и похожие фамилия с именем, или то же ФИО
 * с датой рождения в пределах года (опечатка в дате). Результат — в публичном виде (Q-04).
 */
export async function findAthleteDuplicates(
  db: QueryClient,
  person: { lastName: string; firstName: string; birthDate: string },
  opts: { excludeAthleteId?: string | null; limit?: number } = {},
): Promise<DuplicateCandidate[]> {
  const last = normalizeName(person.lastName);
  const first = normalizeName(person.firstName);
  const full = `${last} ${first}`;
  const birth = new Date(`${person.birthDate}T00:00:00.000Z`);
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT a.id AS athlete_id, p.last_name, p.first_name,
           EXTRACT(YEAR FROM p.birth_date)::int AS birth_year,
           club.short_name AS club_short_name, r.name_ru AS region_name_ru, r.name_en AS region_name_en,
           CASE WHEN p.last_name_norm = ${last} AND p.first_name_norm = ${first} AND p.birth_date = ${birth}::date
                THEN 1.0
                ELSE similarity(p.last_name_norm || ' ' || p.first_name_norm, ${full}) END::float8 AS sim
    FROM person p
    JOIN athlete_profile a ON a.person_id = p.id
    LEFT JOIN LATERAL (
      SELECT o.short_name, o.region_id FROM athlete_membership m
      JOIN organization o ON o.id = m.organization_id
      WHERE m.athlete_id = a.id AND (m.valid_to IS NULL OR m.valid_to >= current_date)
      ORDER BY m.is_primary DESC, m.valid_from DESC
      LIMIT 1
    ) club ON true
    LEFT JOIN region r ON r.id = COALESCE(p.region_id, club.region_id)
    WHERE p.deleted_at IS NULL AND p.merged_into_id IS NULL
      AND a.id IS DISTINCT FROM ${opts.excludeAthleteId ?? null}::uuid
      AND (
        (p.birth_date = ${birth}::date
          AND similarity(p.last_name_norm || ' ' || p.first_name_norm, ${full}) >= ${DUPLICATE_SIMILARITY_THRESHOLD})
        OR (p.last_name_norm = ${last} AND p.first_name_norm = ${first}
          AND p.birth_date BETWEEN (${birth}::date - 366) AND (${birth}::date + 366))
      )
    ORDER BY sim DESC, a.id
    LIMIT ${opts.limit ?? 10}`);
  return rows.map((r) => ({
    athleteId: r.athlete_id,
    publicName: `${r.last_name} ${r.first_name.charAt(0).toUpperCase()}.`,
    birthYear: r.birth_year,
    clubShortName: r.club_short_name,
    regionName: r.region_name_ru && r.region_name_en ? { ru: r.region_name_ru, en: r.region_name_en } : null,
    similarity: Math.round(Number(r.sim) * 100) / 100,
  }));
}

/** Люди с тем же ФИО и датой рождения (тренеры, судьи, представители, «я»). */
export async function findExactPersons(
  db: QueryClient,
  person: { lastName: string; firstName: string; middleName?: string | null; birthDate: string },
  opts: { excludePersonId?: string | null; matchMiddleName?: boolean } = {},
): Promise<string[]> {
  const birth = new Date(`${person.birthDate}T00:00:00.000Z`);
  const middle = person.middleName ? normalizeName(person.middleName) : null;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM person
    WHERE last_name_norm = ${normalizeName(person.lastName)} AND first_name_norm = ${normalizeName(person.firstName)}
      AND birth_date = ${birth}::date AND deleted_at IS NULL AND merged_into_id IS NULL
      AND id IS DISTINCT FROM ${opts.excludePersonId ?? null}::uuid
      AND (${!opts.matchMiddleName} OR coalesce(replace(lower(middle_name), 'ё', 'е'), '') = ${middle ?? ''})
    ORDER BY id
    LIMIT 5`);
  return rows.map((r) => r.id);
}
