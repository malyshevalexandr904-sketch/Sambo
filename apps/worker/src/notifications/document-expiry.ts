// Предупреждения о сроке документов спортсмена (правки 05.11.2026, «Мои документы»): за 30, 7 и 1 день до окончания
// срока действия и после того, как он истёк. Каждому этапу — одно уведомление получателю (детерминированный ключ
// источника: документ + этап), повторный обход ничего не дублирует. Получатели — сам спортсмен с учётной записью,
// подтверждённые действующие представители и загрузивший документ (например, тренер).
import type { PrismaClient } from '@sde/db';
import type { PlannedNotification } from './recipients';
import { sourceKey } from './soon';

const DAY = 24 * 60 * 60 * 1000;

/** Обход раз в 6 часов: этап дня наступает не позже чем через 6 часов после полуночи UTC. */
export const DOCUMENT_EXPIRY_SCAN_EVERY_MS = 6 * 60 * 60 * 1000;

/** За сколько дней до окончания срока предупреждать (по убыванию). */
export const EXPIRY_WARNING_DAYS = [30, 7, 1] as const;

/** Об истёкшем сроке напоминаем только в первые 30 дней — старые документы из истории не будят получателей. */
const EXPIRED_NOTICE_DAYS = 30;

export type ExpiryStage = 'd30' | 'd7' | 'd1' | 'expired';

/** Полных дней от `today` до `expirationDate` (обе — YYYY-MM-DD); в сам день окончания — 0. */
export function daysUntil(expirationDate: string, today: string): number {
  return Math.round((Date.parse(`${expirationDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

/**
 * Этап предупреждения: ближайший порог, до которого дошёл срок. В сам день окончания документ ещё действует
 * (этап «1 день»), на следующий день — «истёк». Дальше 30 дней и истёкшие больше 30 дней назад — без уведомления.
 */
export function expiryStage(expirationDate: string, today: string): ExpiryStage | null {
  const left = daysUntil(expirationDate, today);
  if (left < 0) return left >= -EXPIRED_NOTICE_DAYS ? 'expired' : null;
  for (const d of [...EXPIRY_WARNING_DAYS].reverse()) if (left <= d) return `d${d}` as ExpiryStage;
  return null;
}

export const expirySourceKey = (documentId: string, stage: ExpiryStage): string =>
  sourceKey('document-expiry', documentId, stage);

export interface ExpiryPlan {
  sourceId: string;
  plan: PlannedNotification;
}

type ActiveUser = { id: string; status: string; deletedAt: Date | null } | null | undefined;
const active = (u: ActiveUser): u is { id: string; status: string; deletedAt: null } =>
  !!u && u.status === 'ACTIVE' && u.deletedAt === null;

/**
 * Уведомления о сроке на сегодня: действующие документы спортсменов (не удалены, не отклонены, не заменены более
 * новым того же вида) со сроком в окне [сегодня − 30 дней; сегодня + 30 дней].
 */
export async function planDocumentExpiry(db: PrismaClient, today: string): Promise<ExpiryPlan[]> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - EXPIRED_NOTICE_DAYS * DAY);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + EXPIRY_WARNING_DAYS[0] * DAY);
  const docs = await db.document.findMany({
    where: {
      athleteId: { not: null },
      deletedAt: null,
      status: { not: 'REJECTED' },
      expirationDate: { gte: from, lte: to },
    },
    select: {
      id: true,
      athleteId: true,
      typeCode: true,
      uploadedAt: true,
      expirationDate: true,
      uploadedBy: { select: { id: true, status: true, deletedAt: true } },
      athlete: {
        select: {
          person: { select: { user: { select: { id: true, status: true, deletedAt: true } } } },
          guardians: {
            where: { verifiedAt: { not: null }, endedAt: null },
            select: {
              guardianPerson: { select: { user: { select: { id: true, status: true, deletedAt: true } } } },
            },
          },
        },
      },
    },
    take: 5000,
  });
  const out: ExpiryPlan[] = [];
  for (const doc of docs) {
    if (!doc.athleteId || !doc.expirationDate || !doc.athlete) continue;
    const stage = expiryStage(doc.expirationDate.toISOString().slice(0, 10), today);
    if (!stage) continue;
    // Документ заменён: у спортсмена есть загруженный позже документ того же вида — предупреждать не о чем.
    const newer = await db.document.findFirst({
      where: {
        athleteId: doc.athleteId,
        typeCode: doc.typeCode,
        deletedAt: null,
        status: { not: 'REJECTED' },
        uploadedAt: { gt: doc.uploadedAt },
      },
      select: { id: true },
    });
    if (newer) continue;
    const type = stage === 'expired' ? 'document.expired' : 'document.expiring';
    const sourceId = expirySourceKey(doc.id, stage);
    const params = { documentId: doc.id, athleteId: doc.athleteId };
    const seen = new Set<string>();
    const add = (userId: string, self: boolean): void => {
      if (seen.has(userId)) return;
      seen.add(userId);
      out.push({
        sourceId,
        plan: { userId, type, params: self ? { ...params, self: '1' } : params, competitionId: null },
      });
    };
    const selfUser = doc.athlete.person.user;
    if (active(selfUser)) add(selfUser.id, true);
    for (const g of doc.athlete.guardians) {
      const u = g.guardianPerson.user;
      if (active(u)) add(u.id, false);
    }
    if (active(doc.uploadedBy)) add(doc.uploadedBy.id, false);
  }
  return out;
}
