// Подстановки для текста уведомления (DATABASE.md, 3.8): в уведомлении хранятся только идентификаторы и коды,
// названия и причины берутся из исходных записей при показе (API) и при отправке письма (worker).
import type { Prisma } from '../generated/client/index.js';

type Reader = Pick<Prisma.TransactionClient, 'application' | 'entry' | 'document'>;

export interface NotificationSource {
  competitionName?: string;
  organizationName?: string;
  /** Организация заявки — для проверки, что получатель всё ещё её владелец. */
  organizationId?: string;
  athleteName?: string;
  documentType?: string;
  status?: string;
  reason?: string;
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
  return app;
}
