// Общие шаги команд над участиями: блокировки строк, ошибки совместимости, снимок из участия.
import { type Entry, Prisma, type Tx } from '@sde/db';
import type { EntryStatus } from '@sde/contracts';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import type { AthleteRegistrationInfo } from '../../athletes';
import { type CompetitionCategorySpec, MERGEABLE } from '../../categories';
import { type CompetitionBasics, registrationWindow } from '../../competitions';
import { buildSnapshot, decisionAllowed } from '../domain/entry-rules';

/** Решения по участникам — до начала жеребьёвки: при регистрации и на мандатной комиссии. */
export const DECISION_PHASE = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];

export const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function lockApplication(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM application WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.application.findUniqueOrThrow({ where: { id } });
}

export async function lockEntry(tx: Tx, id: string, version?: number) {
  await tx.$queryRaw`SELECT id FROM entry WHERE id = ${id}::uuid FOR UPDATE`;
  const entry = await tx.entry.findUniqueOrThrow({ where: { id } });
  if (version !== undefined && entry.version !== version) throw versionConflict(entry.version);
  return entry;
}

/** Инвариант «не больше N категорий на спортсмена» — по нескольким строкам: advisory lock (ARCHITECTURE.md, 10). */
export async function lockAthleteInCompetition(
  tx: Tx,
  competitionId: string,
  athleteId: string,
): Promise<void> {
  const key = `${competitionId}:${athleteId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Заявка категории, лимит и совместимость — ошибки раздела 53 по причинам совместимости. */
export function eligibilityError(reasons: string[]): DomainError {
  if (reasons.includes('ALREADY_ENTERED')) return new DomainError('ATHLETE_ALREADY_ENTERED');
  if (reasons.includes('MAX_CATEGORIES_REACHED')) return new DomainError('MAX_CATEGORIES_EXCEEDED');
  if (reasons.includes('CATEGORY_CLOSED'))
    return new DomainError('REGISTRATION_CLOSED', { reason: 'category_closed' });
  return new DomainError('CATEGORY_INCOMPATIBLE', { reasons });
}

/** Данные спортсмена для проверки совместимости — из снимка участия (перевод оценивается по снимку). */
export function athleteFromSnapshot(entry: Entry): AthleteRegistrationInfo {
  return {
    athleteId: entry.athleteId,
    personId: '',
    status: 'ACTIVE',
    lastName: entry.snapLastName,
    firstName: entry.snapFirstName,
    middleName: entry.snapMiddleName,
    birthDate: entry.snapBirthDate.toISOString().slice(0, 10),
    gender: entry.snapGender,
    personRegionId: entry.snapRegionId,
    memberships: [],
    coachName: entry.snapCoachName,
    rankCode: entry.snapRankCode,
  };
}

/** Решение по участию недопустимо в его статусе: `INVALID_TRANSITION` с допустимыми решениями. */
export function invalidDecision(status: EntryStatus, decision: 'APPROVED' | 'REJECTED'): DomainError {
  return new DomainError('INVALID_TRANSITION', {
    from: status,
    to: decision,
    allowed: (['APPROVED', 'REJECTED'] as const).filter((d) => decisionAllowed(status, d)),
  });
}

/** Перевод между категориями одного турнира, обе — до жеребьёвки. */
export function assertTransferable(
  entry: Entry,
  from: CompetitionCategorySpec | null,
  to: CompetitionCategorySpec | null,
): asserts to is CompetitionCategorySpec {
  if (!to || to.competitionId !== entry.competitionId)
    throw new DomainError('NOT_FOUND', { resource: 'category' });
  if (to.id === entry.categoryId)
    throw new DomainError('CATEGORY_TRANSFER_NOT_ALLOWED', { reason: 'same_category' });
  if (!MERGEABLE.includes(to.status) || !from || !MERGEABLE.includes(from.status))
    throw new DomainError('CATEGORY_TRANSFER_NOT_ALLOWED', { reason: 'category_drawn' });
}

/** Окно регистрации турнира открыто — иначе `REGISTRATION_NOT_OPEN` / `REGISTRATION_CLOSED` со сроком. */
export function assertWindowOpen(competition: CompetitionBasics): void {
  const window = registrationWindow(competition, new Date());
  if (window === 'NOT_OPEN')
    throw new DomainError('REGISTRATION_NOT_OPEN', {
      registrationStartsAt: competition.registrationStartsAt.toISOString(),
    });
  if (window === 'CLOSED')
    throw new DomainError('REGISTRATION_CLOSED', {
      registrationEndsAt: competition.registrationEndsAt.toISOString(),
    });
}

/** Снимок данных спортсмена для участия (ADR-10): основной клуб, тренер, регион, разряд на момент заявки. */
export async function snapshotData(tx: Tx, athlete: AthleteRegistrationInfo) {
  const club = athlete.memberships.find((m) => m.isPrimary) ?? athlete.memberships[0] ?? null;
  const snap = buildSnapshot({
    lastName: athlete.lastName,
    firstName: athlete.firstName,
    middleName: athlete.middleName,
    birthDate: athlete.birthDate,
    gender: athlete.gender,
    club: club ? { id: club.organizationId, name: club.name, regionId: club.regionId } : null,
    coachName: athlete.coachName,
    personRegionId: athlete.personRegionId,
    rankCode: athlete.rankCode,
  });
  const region = snap.snapRegionId
    ? await tx.region.findUnique({ where: { id: snap.snapRegionId }, select: { nameRu: true } })
    : null;
  return {
    ...snap,
    snapBirthDate: new Date(`${snap.snapBirthDate}T00:00:00.000Z`),
    snapRegionName: region?.nameRu ?? null,
  };
}
