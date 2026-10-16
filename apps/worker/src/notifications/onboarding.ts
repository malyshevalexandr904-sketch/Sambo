// Уведомления о заявках на регистрацию в системе (Phase 9a): заявителю — «отправлена», «передана организации»,
// «нужно исправить», «решение»; проверяющим — «ждёт проверки»; тренеру и руководителям организации — «присоединён
// участник». Проверяющие: платформа (действующие платформенные роли с TOTP — без него прав нет) или организация
// (руководитель клуба, администратор федерации; тренер — только с назначенным правом и только для спортсмена,
// выбравшего его).
import { EVENT_SCHEMAS, ROLE_CODES, ROLE_PERMISSIONS } from '@sde/contracts';
import type { PrismaClient } from '@sde/db';
import type { PlannedNotification } from './recipients';

export type OnboardingReader = Pick<
  PrismaClient,
  'onboardingRequest' | 'platformRoleAssignment' | 'organizationMembership' | 'coachMembership'
>;

/** Роли с правом проверять заявки: платформенные и организационные. */
const REVIEWER_ROLES = ROLE_CODES.filter((r) => ROLE_PERMISSIONS[r]['onboarding.review'] !== undefined);
const PLATFORM_REVIEWER_ROLES = REVIEWER_ROLES.filter((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN');
const ORGANIZATION_REVIEWER_ROLES = REVIEWER_ROLES.filter((r) => !PLATFORM_REVIEWER_ROLES.includes(r));

const today = (): Date => new Date(new Date().toISOString().slice(0, 10));

interface RequestRow {
  id: string;
  userId: string;
  role: string;
  status: string;
  organizationId: string | null;
  coachId: string | null;
  contactChannels: string[];
}

async function platformReviewers(db: OnboardingReader): Promise<string[]> {
  const rows = await db.platformRoleAssignment.findMany({
    where: {
      revokedAt: null,
      role: { code: { in: PLATFORM_REVIEWER_ROLES } },
      user: { status: 'ACTIVE', deletedAt: null, totpEnabledAt: { not: null } },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function organizationManagers(db: OnboardingReader, organizationId: string): Promise<string[]> {
  const rows = await db.organizationMembership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { code: { in: ORGANIZATION_REVIEWER_ROLES } },
      OR: [{ validTo: null }, { validTo: { gte: today() } }],
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId).filter((x): x is string => !!x);
}

/** Пользователь тренера, работающего в организации; `reviewerOnly` — только с правом рассматривать заявки. */
async function coachUser(
  db: OnboardingReader,
  coachId: string,
  organizationId: string,
  reviewerOnly: boolean,
): Promise<string | null> {
  const m = await db.coachMembership.findFirst({
    where: {
      coachId,
      organizationId,
      validTo: null,
      ...(reviewerOnly ? { canReviewAthletes: true } : {}),
    },
    select: { coach: { select: { person: { select: { user: { select: { id: true, status: true } } } } } } },
  });
  const user = m?.coach.person.user;
  return user && user.status === 'ACTIVE' ? user.id : null;
}

async function reviewersOf(db: OnboardingReader, r: RequestRow): Promise<string[]> {
  if (r.status === 'PENDING_REVIEW') return platformReviewers(db);
  if (r.status !== 'PENDING_ORGANIZATION_APPROVAL' || !r.organizationId) return [];
  const ids = await organizationManagers(db, r.organizationId);
  if (r.role === 'ATHLETE' && r.coachId) {
    const coach = await coachUser(db, r.coachId, r.organizationId, true);
    if (coach) ids.push(coach);
  }
  return ids;
}

const plan = (userIds: string[], type: PlannedNotification['type'], params: Record<string, string>) =>
  [...new Set(userIds)].map((userId) => ({ userId, type, params, competitionId: null }));

/** Заявителю — с учётом выбранных им способов связи: email не выбран — письма нет (лента и push остаются). */
const toApplicant = (r: RequestRow, type: PlannedNotification['type'], params: Record<string, string>) =>
  plan([r.userId], type, params).map((n) => ({
    ...n,
    noEmail: r.contactChannels.length > 0 && !r.contactChannels.includes('EMAIL'),
  }));

async function loadRequest(db: OnboardingReader, requestId: string): Promise<RequestRow | null> {
  return db.onboardingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      organizationId: true,
      coachId: true,
      contactChannels: true,
    },
  });
}

export async function planOnboardingNotifications(
  db: OnboardingReader,
  type: string,
  payload: unknown,
): Promise<PlannedNotification[]> {
  switch (type) {
    case 'onboarding.submitted': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      const r = await loadRequest(db, p.requestId);
      if (!r) return [];
      const applicantType =
        p.status === 'PENDING_ORGANIZATION_APPROVAL' ? 'onboarding.forwarded' : 'onboarding.submitted';
      const reviewers = (await reviewersOf(db, { ...r, status: p.status })).filter((id) => id !== r.userId);
      return [
        ...toApplicant(r, applicantType, { requestId: r.id }),
        ...plan(reviewers, 'onboarding.awaiting_review', { requestId: r.id }),
      ];
    }
    case 'onboarding.changes_requested': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      const r = await loadRequest(db, p.requestId);
      return r ? toApplicant(r, 'onboarding.changes_requested', { requestId: r.id }) : [];
    }
    case 'onboarding.decided': {
      const p = EVENT_SCHEMAS[type].parse(payload);
      const r = await loadRequest(db, p.requestId);
      if (!r) return [];
      const out: PlannedNotification[] = toApplicant(r, 'onboarding.decided', {
        requestId: r.id,
        status: p.status,
      });
      // Спортсмен или тренер присоединён к организации (и к тренеру): тренеру и руководителям организации.
      if (p.status === 'APPROVED' && r.organizationId && (r.role === 'ATHLETE' || r.role === 'COACH')) {
        const ids = await organizationManagers(db, r.organizationId);
        if (r.role === 'ATHLETE' && r.coachId) {
          const coach = await coachUser(db, r.coachId, r.organizationId, false);
          if (coach) ids.push(coach);
        }
        out.push(
          ...plan(
            ids.filter((id) => id !== r.userId),
            'onboarding.linked',
            { requestId: r.id },
          ),
        );
      }
      return out;
    }
    default:
      return [];
  }
}
