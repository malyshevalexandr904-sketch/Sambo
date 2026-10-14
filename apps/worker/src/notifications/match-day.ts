// Уведомления дня соревнований (Phase 8b; раздел 30): «скоро выступает», «началась схватка», «изменилось время
// схватки». Получатели спортсмена — подтверждённые действующие представители, сам спортсмен с учётной записью и
// подписавшиеся, пока у подписавшегося есть доступ (представитель, сам или действующий член клуба заявки с правом
// подавать заявки). Одно уведомление на получателя и схватку: у тренера двух спортсменов одной схватки — одно.
import type { NotificationType } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';
import { APPLICANT_ROLES, type PlannedNotification } from './recipients';
import { dueSoon, type SoonDue, type SoonQueueItem, sourceKey } from './soon';

export type MatchDayReader = Pick<
  PrismaClient,
  'match' | 'matchSchedule' | 'guardian' | 'user' | 'follow' | 'organizationMembership' | 'competition'
>;

interface Subject {
  entryId: string;
  athleteId: string;
  personId: string;
  organizationId: string;
}

/** Получатель → его спортсмены схватки (спортсмен → участие). */
type Audience = Map<string, Map<string, string>>;

function add(to: Audience, userId: string, s: Subject): void {
  const m = to.get(userId) ?? new Map<string, string>();
  m.set(s.athleteId, s.entryId);
  to.set(userId, m);
}

async function subjectsOf(db: MatchDayReader, matchId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      competitionId: true,
      status: true,
      participants: {
        select: {
          entry: {
            select: {
              id: true,
              status: true,
              athleteId: true,
              athlete: { select: { personId: true } },
              application: { select: { organizationId: true } },
            },
          },
        },
      },
    },
  });
  if (!match) return null;
  const subjects: Subject[] = [];
  for (const p of match.participants)
    if (p.entry && p.entry.status === 'APPROVED')
      subjects.push({
        entryId: p.entry.id,
        athleteId: p.entry.athleteId,
        personId: p.entry.athlete.personId,
        organizationId: p.entry.application.organizationId,
      });
  return { competitionId: match.competitionId, status: match.status, subjects };
}

/** Действующий пользователь: не заблокирован, не удалён. */
const ACTIVE_USER = { status: 'ACTIVE' as const, deletedAt: null };

async function audienceOf(db: MatchDayReader, subjects: readonly Subject[]): Promise<Audience> {
  const out: Audience = new Map();
  if (subjects.length === 0) return out;
  const athleteIds = subjects.map((s) => s.athleteId);
  const byAthlete = new Map(subjects.map((s) => [s.athleteId, s]));
  const byPerson = new Map(subjects.map((s) => [s.personId, s]));
  const [guardians, selves, follows] = await Promise.all([
    db.guardian.findMany({
      where: {
        athleteId: { in: athleteIds },
        verifiedAt: { not: null },
        endedAt: null,
        guardianPerson: { user: ACTIVE_USER },
      },
      select: { athleteId: true, guardianPerson: { select: { user: { select: { id: true } } } } },
    }),
    db.user.findMany({
      where: { personId: { in: [...byPerson.keys()] }, ...ACTIVE_USER },
      select: { id: true, personId: true },
    }),
    db.follow.findMany({
      where: { targetType: 'ATHLETE', targetId: { in: athleteIds }, user: ACTIVE_USER },
      select: { userId: true, targetId: true },
    }),
  ]);
  for (const g of guardians) {
    const s = byAthlete.get(g.athleteId);
    if (s && g.guardianPerson.user) add(out, g.guardianPerson.user.id, s);
  }
  for (const u of selves) {
    const s = u.personId ? byPerson.get(u.personId) : undefined;
    if (s) add(out, u.id, s);
  }
  // Подписавшиеся без родства — пока они в клубе заявки спортсмена с правом подавать заявки.
  const pending = follows.filter((f) => !out.get(f.userId)?.has(f.targetId));
  if (pending.length > 0) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const members = await db.organizationMembership.findMany({
      where: {
        userId: { in: [...new Set(pending.map((f) => f.userId))] },
        organizationId: { in: [...new Set(subjects.map((s) => s.organizationId))] },
        status: 'ACTIVE',
        role: { code: { in: APPLICANT_ROLES } },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
      },
      select: { userId: true, organizationId: true },
    });
    const clubOf = new Set(members.map((m) => `${m.userId}:${m.organizationId}`));
    for (const f of pending) {
      const s = byAthlete.get(f.targetId);
      if (s && clubOf.has(`${f.userId}:${s.organizationId}`)) add(out, f.userId, s);
    }
  }
  return out;
}

/** Уведомления о схватке всем получателям её спортсменов. Спортсмен у получателя один — ссылка на его карточку. */
export async function planMatchNotifications(
  db: MatchDayReader,
  type: Extract<NotificationType, 'match.soon' | 'match.started' | 'match.time_changed'>,
  matchId: string,
  extra: Record<string, string> = {},
): Promise<PlannedNotification[]> {
  const found = await subjectsOf(db, matchId);
  if (!found) return [];
  const audience = await audienceOf(db, found.subjects);
  return [...audience].map(([userId, athletes]) => {
    const single = athletes.size === 1 ? [...athletes][0] : undefined;
    return {
      userId,
      type,
      competitionId: found.competitionId,
      params: {
        competitionId: found.competitionId,
        matchId,
        ...(single ? { athleteId: single[0], entryId: single[1] } : {}),
        ...extra,
      },
    };
  });
}

/** Ключ «скоро» по схватке: одно такое уведомление на получателя, сколько бы раз ни проверялась очередь. */
export const soonSourceKey = (matchId: string): string => sourceKey('match.soon', matchId);
/** «Изменилось время»: по событию правки расписания и схватке. */
export const timeChangedSourceKey = (eventId: string, matchId: string): string =>
  sourceKey('match.time_changed', eventId, matchId);

/** Турниры, где сейчас может понадобиться «скоро»: расписание опубликовано или соревнования идут. */
const SOON_STATUSES = ['SCHEDULED', 'IN_PROGRESS'] as const;
const QUEUE_STATUSES = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'PAUSED'] as const;

/** Схватки турнира, о которых пора сообщить «скоро» (по коврам, правило — `dueSoon`). */
export async function soonDueFor(
  db: MatchDayReader,
  competitionId: string,
  nowMs: number,
): Promise<SoonDue[]> {
  const competition = await db.competition.findUnique({
    where: { id: competitionId },
    select: { status: true, deletedAt: true, notifyMatchesAhead: true },
  });
  if (
    !competition ||
    competition.deletedAt ||
    competition.notifyMatchesAhead <= 0 ||
    !(SOON_STATUSES as readonly string[]).includes(competition.status)
  )
    return [];
  const rows = await db.matchSchedule.findMany({
    where: { competitionId, match: { status: { in: [...QUEUE_STATUSES] } } },
    select: {
      matId: true,
      plannedAt: true,
      orderInMat: true,
      match: {
        select: {
          id: true,
          status: true,
          participants: { select: { entryId: true, entry: { select: { status: true } } } },
        },
      },
    },
  });
  const byMat = new Map<string, SoonQueueItem[]>();
  for (const r of rows) {
    const parts = r.match.participants;
    const item: SoonQueueItem = {
      matchId: r.match.id,
      plannedAt: r.plannedAt.getTime(),
      orderInMat: r.orderInMat,
      status: r.match.status as SoonQueueItem['status'],
      paired: parts.length === 2 && parts.every((p) => p.entryId !== null),
      withdrawn: parts.some((p) => p.entry?.status === 'WITHDRAWN'),
    };
    byMat.set(r.matId, [...(byMat.get(r.matId) ?? []), item]);
  }
  return [...byMat.values()].flatMap((items) => dueSoon(items, competition.notifyMatchesAhead, nowMs));
}

/** Идущие турниры для поминутной проверки «скоро» (перенос, отмена, начало сессии — без событий outbox). */
export async function soonCompetitions(db: MatchDayReader): Promise<string[]> {
  const rows = await db.competition.findMany({
    where: { status: { in: [...SOON_STATUSES] }, deletedAt: null, notifyMatchesAhead: { gt: 0 } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
