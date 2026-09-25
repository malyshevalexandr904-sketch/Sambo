// Документ: машина состояний (ARCHITECTURE.md, 16.4) и проверки файла по типу документа.
import type { DocumentStatus } from '@sde/contracts';

export type ReviewTarget = 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

const REVIEW: Record<DocumentStatus, readonly ReviewTarget[]> = {
  UPLOADED: ['UNDER_REVIEW', 'VERIFIED', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: [],
  REJECTED: [],
  EXPIRED: [],
};

export type ReviewCheck =
  | { ok: true; reasonRequired: boolean }
  | { ok: false; code: 'DOCUMENT_ALREADY_REVIEWED' | 'INVALID_TRANSITION'; allowed: readonly ReviewTarget[] };

/**
 * UPLOADED → UNDER_REVIEW → VERIFIED | REJECTED (решение можно принять и сразу из UPLOADED).
 * Проверенный или отклонённый документ не пересматривается: исправление — новая загрузка.
 */
export function checkReview(from: DocumentStatus, to: ReviewTarget): ReviewCheck {
  const allowed = REVIEW[from];
  if (allowed.includes(to)) return { ok: true, reasonRequired: to === 'REJECTED' };
  if (from === 'VERIFIED' || from === 'REJECTED')
    return { ok: false, code: 'DOCUMENT_ALREADY_REVIEWED', allowed };
  return { ok: false, code: 'INVALID_TRANSITION', allowed };
}

/** Удалить может загрузивший, пока документ не взят на проверку. */
export const canDelete = (status: DocumentStatus): boolean => status === 'UPLOADED';

/** Срок действия истёк: дата окончания раньше сегодняшней (в сам день окончания документ ещё действует). */
export const isExpired = (expirationDate: string | null, today: string): boolean =>
  expirationDate !== null && expirationDate < today;

/** Тип файла разрешён типом документа (DocumentType.allowedMime — список через запятую). */
export function mimeAllowed(allowedMime: string, mimeType: string): boolean {
  return allowedMime
    .split(',')
    .map((m) => m.trim())
    .includes(mimeType);
}
