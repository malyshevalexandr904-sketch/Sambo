// Данные команд турнира: запись при создании и изменении, запреты после публикации, изменение сроков,
// разница для аудита и поля перехода статуса. Без обращений к БД — только преобразования.
import {
  type CompetitionCreate,
  type CompetitionPatch,
  type CompetitionStatus,
  type CompetitionTransitionRequest,
  scheduleIssues,
} from '@sde/contracts';
import type { Competition, Prisma } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { isPublished } from '../domain/competition-machine';

export const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** Поля расписания: их изменение у опубликованного турнира требует причины и уведомляет участников. */
const SCHEDULE_FIELDS = [
  'timezone',
  'startDate',
  'endDate',
  'registrationStartsAt',
  'registrationEndsAt',
] as const;

export function createData(
  input: CompetitionCreate,
  id: string,
  slug: string,
  userId: string,
): Prisma.CompetitionUncheckedCreateInput {
  return {
    id,
    slug,
    name: input.name,
    shortName: input.shortName ?? null,
    descriptionMd: input.descriptionMd ?? null,
    organizerOrganizationId: input.organizerOrganizationId,
    venueId: input.venueId ?? null,
    timezone: input.timezone,
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    registrationStartsAt: new Date(input.registrationStartsAt),
    registrationEndsAt: new Date(input.registrationEndsAt),
    level: input.level,
    disciplineCode: input.disciplineCode,
    ruleSetVersionId: input.ruleSetVersionId ?? null,
    logoFileId: input.logoFileId ?? null,
    contactInfo: input.contactInfo ?? undefined,
    createdById: userId,
    updatedById: userId,
  };
}

/**
 * Проверка изменения опубликованного турнира: дисциплину, правила и адрес не меняют; сроки — только с причиной
 * и без нарушения расписания в поясе турнира. Возвращает, изменились ли сроки.
 */
export function assertEditable(current: Competition, patch: CompetitionPatch): { scheduleChanged: boolean } {
  if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(current.status))
    throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
  const published = isPublished(current.status);
  const changed = <K extends 'disciplineCode' | 'ruleSetVersionId' | 'slug'>(k: K): boolean =>
    patch[k] !== undefined && patch[k] !== current[k];
  const failed = published
    ? [
        ...(changed('disciplineCode') ? ['published_discipline_locked'] : []),
        ...(changed('ruleSetVersionId') ? ['published_ruleset_locked'] : []),
        ...(changed('slug') ? ['published_slug_locked'] : []),
      ]
    : [];
  if (failed.length > 0) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });
  const issues = scheduleIssues(mergedSchedule(current, patch));
  if (issues.length > 0) throw new DomainError('VALIDATION_FAILED', { fields: issues });
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => {
    const next = patch[f];
    if (next === undefined) return false;
    if (f === 'timezone') return next !== current.timezone;
    if (f === 'startDate' || f === 'endDate') return next !== dateOnly(current[f]);
    return Date.parse(next) !== current[f].getTime();
  });
  if (published && scheduleChanged && !patch.reason) throw new DomainError('REASON_REQUIRED');
  return { scheduleChanged: published && scheduleChanged };
}

/** Сроки после изменения: новые значения поверх текущих. */
export function mergedSchedule(current: Competition, patch: CompetitionPatch) {
  return {
    timezone: patch.timezone ?? current.timezone,
    startDate: patch.startDate ?? dateOnly(current.startDate),
    endDate: patch.endDate ?? dateOnly(current.endDate),
    registrationStartsAt: patch.registrationStartsAt ?? current.registrationStartsAt.toISOString(),
    registrationEndsAt: patch.registrationEndsAt ?? current.registrationEndsAt.toISOString(),
  };
}

export function updateData(
  patch: CompetitionPatch,
  slug: string | undefined,
  userId: string,
): Prisma.CompetitionUncheckedUpdateManyInput {
  return {
    name: patch.name,
    shortName: patch.shortName,
    slug,
    descriptionMd: patch.descriptionMd,
    venueId: patch.venueId,
    timezone: patch.timezone,
    startDate: patch.startDate ? toDate(patch.startDate) : undefined,
    endDate: patch.endDate ? toDate(patch.endDate) : undefined,
    registrationStartsAt: patch.registrationStartsAt ? new Date(patch.registrationStartsAt) : undefined,
    registrationEndsAt: patch.registrationEndsAt ? new Date(patch.registrationEndsAt) : undefined,
    level: patch.level,
    disciplineCode: patch.disciplineCode,
    ruleSetVersionId: patch.ruleSetVersionId,
    logoFileId: patch.logoFileId,
    contactInfo: patch.contactInfo !== undefined ? patch.contactInfo : undefined,
    updatedById: userId,
    version: { increment: 1 },
  };
}

/** Изменённые поля «было / стало» для журнала аудита (причина — отдельным полем записи). */
export function auditDiff(
  current: Competition,
  patch: CompetitionPatch,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'reason' || v === undefined) continue;
    before[k] = (current as Record<string, unknown>)[k] ?? null;
    after[k] = v;
  }
  return { before, after };
}

/** Поля перехода статуса: публикация, новый срок при повторном открытии регистрации, отмена с причиной. */
export function transitionData(
  from: CompetitionStatus,
  req: CompetitionTransitionRequest,
  userId: string,
  now: Date,
): Prisma.CompetitionUncheckedUpdateInput {
  const data: Prisma.CompetitionUncheckedUpdateInput = {
    status: req.to,
    version: { increment: 1 },
    updatedById: userId,
  };
  if (req.to === 'REGISTRATION_OPEN' && from === 'DRAFT') data.publishedAt = now;
  if (req.to === 'REGISTRATION_OPEN' && from === 'REGISTRATION_CLOSED' && req.registrationEndsAt)
    data.registrationEndsAt = new Date(req.registrationEndsAt);
  if (req.to === 'CANCELLED') {
    data.cancelledAt = now;
    data.cancelReason = req.reason ?? null;
  }
  return data;
}
