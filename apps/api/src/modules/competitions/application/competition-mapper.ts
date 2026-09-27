// Представление турнира в ответах API. Сущности БД наружу не отдаются (ARCHITECTURE.md, 5).
import type { Competition, CompetitionSummary, RuleSetVersionRef } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { RuleSetVersionInfo } from '../../rulesets';
import { registrationWindow } from '../domain/competition-machine';
import type { CompetitionBasics } from './competition-scope.service';

export const COMPETITION_INCLUDE = {
  organizer: { select: { id: true, name: true, shortName: true } },
  venue: { select: { id: true, name: true, address: true, city: true } },
  logo: { select: { storageKey: true, status: true } },
  regulation: { select: { id: true, storageKey: true, status: true, originalName: true } },
} satisfies Prisma.CompetitionInclude;

export type CompetitionRow = Prisma.CompetitionGetPayload<{ include: typeof COMPETITION_INCLUDE }>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

export function toBasics(row: CompetitionRow): CompetitionBasics {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    organizerOrganizationId: row.organizerOrganizationId,
    disciplineCode: row.disciplineCode,
    timezone: row.timezone,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    registrationStartsAt: row.registrationStartsAt,
    registrationEndsAt: row.registrationEndsAt,
    ruleSetVersionId: row.ruleSetVersionId,
  };
}

export function toSummary(
  row: CompetitionRow,
  now: Date,
  publicUrl: (storageKey: string) => string,
): CompetitionSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName,
    organizer: row.organizer,
    venue: row.venue,
    timezone: row.timezone,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    registrationStartsAt: row.registrationStartsAt.toISOString(),
    registrationEndsAt: row.registrationEndsAt.toISOString(),
    status: row.status,
    level: row.level,
    disciplineCode: row.disciplineCode,
    registrationOpenNow: registrationWindow(row, now) === 'OPEN',
    logoUrl: row.logo?.status === 'AVAILABLE' ? publicUrl(row.logo.storageKey) : null,
  };
}

/** Закреплённая версия правил в ответе турнира. */
export function toRuleSetVersionRef(v: RuleSetVersionInfo): RuleSetVersionRef {
  return {
    id: v.id,
    ruleSetId: v.ruleSetId,
    ruleSetCode: v.ruleSetCode,
    ruleSetName: v.ruleSetName,
    version: v.version,
    status: v.status,
    checksum: v.checksum,
  };
}

/** Файл положения: ссылка — только когда файл проверен и лежит в публичном хранилище. */
export function toRegulation(
  row: CompetitionRow,
  publicUrl: (storageKey: string) => string,
): Competition['regulation'] {
  if (!row.regulation) return null;
  return {
    fileId: row.regulation.id,
    fileName: row.regulation.originalName,
    url: row.regulation.status === 'AVAILABLE' ? publicUrl(row.regulation.storageKey) : null,
  };
}
