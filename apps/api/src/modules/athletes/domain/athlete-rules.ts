// Правила спортсмена: периоды членства и тренера, переход в другой клуб, статусы, согласия.
import {
  CONSENT_KINDS,
  type ConsentKind,
  type ConsentsStatus,
  isAdultOn,
  type ProfileStatus,
} from '@sde/contracts';

export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

export const todayIso = (): string => dateOnly(new Date());

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dateOnly(d);
}

/** Период действует сегодня или в будущем: конец не задан или не наступил. */
export const isCurrent = (validTo: string | null, today: string): boolean =>
  validTo === null || validTo >= today;

/**
 * Новая основная организация (или основной тренер) с даты `newFrom`: прежняя основная закрывается днём раньше
 * (API.md, 4.1). Нельзя начать новую раньше, чем началась текущая.
 */
export function primaryHandover(
  current: { validFrom: string } | null,
  newFrom: string,
): { ok: true; closeCurrentAt: string | null } | { ok: false } {
  if (!current) return { ok: true, closeCurrentAt: null };
  if (newFrom <= current.validFrom) return { ok: false };
  return { ok: true, closeCurrentAt: dayBefore(newFrom) };
}

/** Окончание периода: не раньше начала. */
export const endDateValid = (validFrom: string, validTo: string): boolean => validTo >= validFrom;

export type StatusChange =
  { ok: true; permission: 'athlete.update' | 'athlete.archive' } | { ok: false; allowed: ProfileStatus[] };

/**
 * ACTIVE ⇄ INACTIVE — изменение спортсмена; ACTIVE | INACTIVE → ARCHIVED — архивирование;
 * возврат из архива — тоже право архивирования.
 */
export function checkStatusChange(from: ProfileStatus, to: ProfileStatus): StatusChange {
  if (from === to) return { ok: false, allowed: [] };
  if (to === 'ARCHIVED')
    return from === 'ARCHIVED' ? { ok: false, allowed: [] } : { ok: true, permission: 'athlete.archive' };
  if (from === 'ARCHIVED')
    return to === 'ACTIVE' ? { ok: true, permission: 'athlete.archive' } : { ok: false, allowed: ['ACTIVE'] };
  return { ok: true, permission: 'athlete.update' };
}

/** Статус согласий по видам: действующее согласие любой версии текста. */
export function consentsStatus(activeKinds: Iterable<ConsentKind>): ConsentsStatus {
  const given = new Set(activeKinds);
  return Object.fromEntries(
    CONSENT_KINDS.map((k) => [k, given.has(k) ? 'GIVEN' : 'MISSING']),
  ) as ConsentsStatus;
}

export type ConsentActor = { relation: 'SELF' } | { relation: 'GUARDIAN'; verified: boolean } | null;

export type ConsentDecision = 'ALLOWED' | 'GUARDIAN_NOT_VERIFIED' | 'FORBIDDEN';

/**
 * Кто даёт и отзывает согласие электронно (API.md, 4.2): за несовершеннолетнего — только подтверждённый
 * законный представитель из своего аккаунта; совершеннолетний спортсмен — сам за себя. Тренер не может.
 */
export function electronicConsentDecision(
  actor: ConsentActor,
  athleteBirthDate: string,
  today: string,
): ConsentDecision {
  const adult = isAdultOn(athleteBirthDate, today);
  if (!actor) return 'FORBIDDEN';
  if (actor.relation === 'SELF') return adult ? 'ALLOWED' : 'FORBIDDEN';
  if (adult) return 'FORBIDDEN';
  return actor.verified ? 'ALLOWED' : 'GUARDIAN_NOT_VERIFIED';
}
