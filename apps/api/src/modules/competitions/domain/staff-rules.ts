// Персонал турнира (PERMISSIONS.md, 2; D-07): статусы членства и правило «не назначать себя».
import type { MembershipStatus } from '@sde/contracts';

const TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  INVITED: ['ENDED'],
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

export function staffTransitionsFrom(status: MembershipStatus): readonly MembershipStatus[] {
  return TRANSITIONS[status];
}

export const staffTransitionAllowed = (from: MembershipStatus, to: MembershipStatus): boolean =>
  TRANSITIONS[from].includes(to);

/**
 * Себе роль в турнире не назначают и свою роль не меняют: так руководитель турнира не выдаёт себе права
 * главного судьи или врача, которых у него нет (раздельные обязанности, SECURITY.md).
 */
export function selfAssignment(
  actor: { id: string; email: string | null },
  target: { userId?: string | null; email?: string | null },
): boolean {
  if (target.userId && target.userId === actor.id) return true;
  return !!target.email && !!actor.email && target.email.toLowerCase() === actor.email.toLowerCase();
}
