// Подстановки для текста уведомления (DATABASE.md, 3.8): в уведомлении хранятся только идентификаторы и коды,
// названия и причины берутся из исходных записей при показе (API) и при отправке письма (worker).
import type { Prisma } from '../generated/client/index.js';

type Reader = Pick<
  Prisma.TransactionClient,
  'application' | 'entry' | 'document' | 'competition' | 'competitionCategory' | 'match' | 'onboardingRequest'
>;

export interface NotificationSource {
  competitionName?: string;
  categoryName?: string;
  organizationName?: string;
  /** Организация заявки — для проверки, что получатель всё ещё её владелец. */
  organizationId?: string;
  athleteName?: string;
  documentType?: string;
  status?: string;
  reason?: string;
  /** Схватка (Phase 8b): номер ковра (фактический после старта, иначе по расписанию), номер схватки, плановое начало
   *  (ISO) и часовой пояс турнира. */
  matNumber?: string;
  matchNumber?: string;
  plannedAt?: string;
  timezone?: string;
  /** Заявка на регистрацию в системе (Phase 9a): роль заявки. */
  onboardingRole?: string;
}

/**
 * Заявка на регистрацию (Phase 9a): роль, статус (из уведомления — на момент решения), причина решения и организация
 * (выбранная или регистрируемая). Уведомления получают заявитель и проверяющие — им заявка видна.
 */
async function onboardingSource(db: Reader, params: Record<string, string>): Promise<NotificationSource> {
  if (!params.requestId) return {};
  const r = await db.onboardingRequest.findUnique({
    where: { id: params.requestId },
    select: {
      role: true,
      status: true,
      decisionReason: true,
      orgName: true,
      organization: { select: { name: true } },
    },
  });
  if (!r) return {};
  return {
    onboardingRole: r.role,
    status: params.status ?? r.status,
    reason: r.decisionReason ?? undefined,
    organizationName: r.organization?.name ?? r.orgName ?? undefined,
  };
}

async function applicationSource(db: Reader, applicationId: string | undefined): Promise<NotificationSource> {
  if (!applicationId) return {};
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      status: true,
      reviewComment: true,
      organizationId: true,
      competition: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });
  if (!app) return {};
  return {
    competitionName: app.competition.name,
    organizationName: app.organization.name,
    organizationId: app.organizationId,
    status: app.status,
    reason: app.reviewComment ?? undefined,
  };
}

/** «Опубликованы результаты» (Phase 8a): турнир, категория и — если спортсмен один — его «Фамилия И.». */
async function resultsSource(
  db: Reader,
  params: Record<string, string>,
  locale: 'ru' | 'en',
): Promise<NotificationSource> {
  const [competition, category, entry] = await Promise.all([
    params.competitionId
      ? db.competition.findUnique({ where: { id: params.competitionId }, select: { name: true } })
      : null,
    params.categoryId
      ? db.competitionCategory.findUnique({
          where: { id: params.categoryId },
          select: { nameRu: true, nameEn: true },
        })
      : null,
    params.entryId
      ? db.entry.findUnique({ where: { id: params.entryId }, select: { publicName: true } })
      : null,
  ]);
  return {
    competitionName: competition?.name,
    categoryName: category ? (locale === 'en' ? category.nameEn : category.nameRu) : undefined,
    athleteName: entry?.publicName,
  };
}

/** Уведомления дня соревнований (Phase 8b): турнир, ковёр, номер и время схватки, «Фамилия И.» спортсмена. */
async function matchSource(db: Reader, params: Record<string, string>): Promise<NotificationSource> {
  const [match, entry] = await Promise.all([
    params.matchId
      ? db.match.findUnique({
          where: { id: params.matchId },
          select: {
            matchNumber: true,
            mat: { select: { number: true } },
            schedule: { select: { plannedAt: true, mat: { select: { number: true } } } },
            competition: { select: { name: true, timezone: true } },
          },
        })
      : null,
    params.entryId
      ? db.entry.findUnique({ where: { id: params.entryId }, select: { publicName: true } })
      : null,
  ]);
  if (!match) return {};
  const mat = match.mat?.number ?? match.schedule?.mat.number;
  return {
    competitionName: match.competition.name,
    timezone: match.competition.timezone,
    matNumber: mat !== undefined ? String(mat) : undefined,
    matchNumber: match.matchNumber !== null ? String(match.matchNumber) : undefined,
    plannedAt: match.schedule?.plannedAt.toISOString(),
    athleteName: entry?.publicName,
  };
}

const MATCH_TYPES = new Set(['match.soon', 'match.started', 'match.time_changed']);

/** Названия и причина для уведомления типа `type` с параметрами `params`. Нет записи — пустой объект. */
export async function notificationSource(
  db: Reader,
  type: string,
  params: Record<string, string>,
  locale: 'ru' | 'en',
): Promise<NotificationSource> {
  if (type === 'document.rejected') {
    const doc = params.documentId
      ? await db.document.findUnique({
          where: { id: params.documentId },
          select: { rejectReason: true, type: { select: { nameRu: true, nameEn: true } } },
        })
      : null;
    if (!doc) return {};
    return {
      documentType: locale === 'en' ? doc.type.nameEn : doc.type.nameRu,
      reason: doc.rejectReason ?? undefined,
    };
  }
  if (type.startsWith('onboarding.')) return onboardingSource(db, params);
  if (type === 'results.published') return resultsSource(db, params, locale);
  if (MATCH_TYPES.has(type)) return matchSource(db, params);
  const app = await applicationSource(db, params.applicationId);
  if (type === 'entry.rejected') {
    const entry = params.entryId
      ? await db.entry.findUnique({
          where: { id: params.entryId },
          select: { publicName: true, decisionReason: true },
        })
      : null;
    return {
      ...app,
      status: undefined,
      athleteName: entry?.publicName,
      reason: entry?.decisionReason ?? undefined,
    };
  }
  if (type === 'application.decided') return { ...app, status: params.status ?? app.status };
  if (type === 'schedule.changed') {
    const competition = params.competitionId
      ? await db.competition.findUnique({ where: { id: params.competitionId }, select: { name: true } })
      : null;
    return { competitionName: competition?.name };
  }
  return app;
}
