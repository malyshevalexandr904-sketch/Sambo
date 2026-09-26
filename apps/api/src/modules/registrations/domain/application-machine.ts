// Заявка (ARCHITECTURE.md, 16.3; C-02): переходы владельца (клуб) и персонала турнира.
import type { ApplicationStatus, PermissionCode } from '@sde/contracts';

export type Actor = 'OWNER' | 'STAFF';

export interface ApplicationTransition {
  from: ApplicationStatus;
  to: ApplicationStatus;
  actor: Actor;
  /** Право персонала турнира; владельцу достаточно APPLICATION_OWNER. */
  permission: PermissionCode | null;
  commentRequired: boolean;
}

const owner = (from: ApplicationStatus, to: ApplicationStatus): ApplicationTransition => ({
  from,
  to,
  actor: 'OWNER',
  permission: null,
  commentRequired: false,
});
const staff = (
  from: ApplicationStatus,
  to: ApplicationStatus,
  permission: PermissionCode,
  commentRequired = false,
): ApplicationTransition => ({ from, to, actor: 'STAFF', permission, commentRequired });

export const APPLICATION_TRANSITIONS: readonly ApplicationTransition[] = [
  owner('DRAFT', 'SUBMITTED'),
  owner('WAITING_DOCUMENTS', 'SUBMITTED'),
  owner('DRAFT', 'CANCELLED'),
  owner('SUBMITTED', 'CANCELLED'),
  owner('WAITING_DOCUMENTS', 'CANCELLED'),
  staff('SUBMITTED', 'UNDER_REVIEW', 'registration.view'),
  staff('UNDER_REVIEW', 'APPROVED', 'registration.approve'),
  staff('UNDER_REVIEW', 'REJECTED', 'registration.reject', true),
  staff('UNDER_REVIEW', 'WAITING_DOCUMENTS', 'registration.return', true),
  staff('SUBMITTED', 'WAITING_DOCUMENTS', 'registration.return', true),
];

export const findApplicationTransition = (
  from: ApplicationStatus,
  to: ApplicationStatus,
): ApplicationTransition | null =>
  APPLICATION_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;

export const applicationTransitionsFrom = (from: ApplicationStatus): ApplicationTransition[] =>
  APPLICATION_TRANSITIONS.filter((t) => t.from === from);

/** Владелец меняет состав заявки в черновике и после возврата на исправление. */
export const isEditableByOwner = (status: ApplicationStatus): boolean =>
  status === 'DRAFT' || status === 'WAITING_DOCUMENTS';

/** Решения по участникам принимаются по поданной заявке; первое решение берёт заявку в работу. */
export const isUnderStaffReview = (status: ApplicationStatus): boolean =>
  status === 'SUBMITTED' || status === 'UNDER_REVIEW';
