// Получатели уведомлений (DATABASE.md, 3.8): клуб по заявке (подавший и создавший — пока они в клубе с правом
// подавать заявки), клубы участников схваток (дайджест расписания), «опубликованы результаты» — клуб,
// представители и сами спортсмены (Phase 8a).
import { type NotificationType, ROLE_CODES, ROLE_PERMISSIONS } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';

export interface PlannedNotification {
  userId: string;
  type: NotificationType;
  params: Record<string, string>;
  competitionId: string | null;
}

export type RecipientsReader = Pick<
  PrismaClient,
  | 'application'
  | 'entry'
  | 'document'
  | 'user'
  | 'organizationMembership'
  | 'matchParticipant'
  | 'placement'
  | 'guardian'
>;

/** Организационные роли с правом подавать заявки: получатели уведомлений о заявке — только они. */
const APPLICANT_ROLES = ROLE_CODES.filter(
  (r) => ROLE_PERMISSIONS[r]['registration.create'] !== undefined && r !== 'SUPER_ADMIN',
);

/** Действующие пользователи клуба с правом подавать заявки — получатели дайджеста изменений расписания. */
export async function organizationRecipients(
  db: RecipientsReader,
  organizationId: string,
): Promise<string[]> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const members = await db.organizationMembership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { code: { in: APPLICANT_ROLES } },
      OR: [{ validTo: null }, { validTo: { gte: today } }],
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  return [...new Set(members.map((m) => m.userId).filter((x): x is string => !!x))];
}

/** Клубы (организации заявок), чьи участники затронуты этими схватками. */
export async function affectedOrganizations(db: RecipientsReader, matchIds: string[]): Promise<string[]> {
  const rows = await db.matchParticipant.findMany({
    where: { matchId: { in: matchIds }, entryId: { not: null } },
    select: { entry: { select: { application: { select: { organizationId: true } } } } },
  });
  return [...new Set(rows.map((r) => r.entry?.application.organizationId).filter((x): x is string => !!x))];
}

/**
 * Получатели по заявке: подавший и создавший её — если они по-прежнему действующие пользователи с правом подавать
 * заявки в организации заявки (ушедшему из клуба сведения о заявке не отправляются).
 */
export async function applicationRecipients(db: RecipientsReader, applicationId: string) {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { competitionId: true, organizationId: true, submittedByUserId: true, createdById: true },
  });
  if (!app) return null;
  const ids = [...new Set([app.submittedByUserId, app.createdById].filter((x): x is string => !!x))];
  const today = new Date(new Date().toISOString().slice(0, 10));
  const members = await db.organizationMembership.findMany({
    where: {
      organizationId: app.organizationId,
      userId: { in: ids },
      status: 'ACTIVE',
      role: { code: { in: APPLICANT_ROLES } },
      OR: [{ validTo: null }, { validTo: { gte: today } }],
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((m) => m.userId).filter((x): x is string => !!x))];
  return { competitionId: app.competitionId, userIds };
}

type PlacementRow = {
  entry: { id: string; athleteId: string; applicationId: string; athlete: { personId: string } };
};

/** Получатель → его спортсмены категории (спортсмен → участие). */
type AthletesByUser = Map<string, Map<string, string>>;

function addAthlete(to: AthletesByUser, userId: string, athleteId: string, entryId: string): void {
  const m = to.get(userId) ?? new Map<string, string>();
  m.set(athleteId, entryId);
  to.set(userId, m);
}

/** Подтверждённые действующие представители и сами спортсмены с действующей учётной записью. */
async function familyRecipients(
  db: RecipientsReader,
  placements: readonly PlacementRow[],
  out: AthletesByUser,
): Promise<void> {
  const entryOf = new Map(placements.map((p) => [p.entry.athleteId, p.entry.id]));
  const athleteIds = [...entryOf.keys()];
  const guardians = athleteIds.length
    ? await db.guardian.findMany({
        where: { athleteId: { in: athleteIds }, verifiedAt: { not: null }, endedAt: null },
        select: {
          athleteId: true,
          guardianPerson: { select: { user: { select: { id: true, status: true, deletedAt: true } } } },
        },
      })
    : [];
  for (const g of guardians) {
    const u = g.guardianPerson.user;
    const entryId = entryOf.get(g.athleteId);
    if (u?.status === 'ACTIVE' && u.deletedAt === null && entryId)
      addAthlete(out, u.id, g.athleteId, entryId);
  }
  const byPerson = new Map(placements.map((p) => [p.entry.athlete.personId, p.entry]));
  const selves = byPerson.size
    ? await db.user.findMany({
        where: { personId: { in: [...byPerson.keys()] }, status: 'ACTIVE', deletedAt: null },
        select: { id: true, personId: true },
      })
    : [];
  for (const u of selves) {
    const entry = u.personId ? byPerson.get(u.personId) : undefined;
    if (entry) addAthlete(out, u.id, entry.athleteId, entry.id);
  }
}

/**
 * Получатели «опубликованы результаты» (план Phase 8a, §5): по каждому месту категории — клуб (подавший и
 * создавший заявку, пока они в клубе с правом подавать заявки), подтверждённые действующие представители и сам
 * спортсмен с учётной записью. Одно уведомление на получателя; спортсмен один — ссылка на его карточку.
 */
export async function resultsRecipients(
  db: RecipientsReader,
  competitionId: string,
  categoryId: string,
): Promise<PlannedNotification[]> {
  const placements: PlacementRow[] = await db.placement.findMany({
    where: { categoryResult: { categoryId } },
    select: {
      entry: {
        select: { id: true, athleteId: true, applicationId: true, athlete: { select: { personId: true } } },
      },
    },
  });
  const athletesOf: AthletesByUser = new Map();
  const club = new Map<string, string[]>();
  for (const { entry } of placements) {
    const users =
      club.get(entry.applicationId) ?? (await applicationRecipients(db, entry.applicationId))?.userIds ?? [];
    club.set(entry.applicationId, users);
    for (const userId of users) addAthlete(athletesOf, userId, entry.athleteId, entry.id);
  }
  await familyRecipients(db, placements, athletesOf);
  return [...athletesOf].map(([userId, athletes]) => {
    const single = athletes.size === 1 ? [...athletes][0] : undefined;
    return {
      userId,
      type: 'results.published' as const,
      params: { competitionId, categoryId, ...(single ? { athleteId: single[0], entryId: single[1] } : {}) },
      competitionId,
    };
  });
}
