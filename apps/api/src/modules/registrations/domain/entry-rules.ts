// Участие (ARCHITECTURE.md, 16.3): решения секретариата, снятие, перевод; снимок данных спортсмена (ADR-10).
import { type EntryStatus, type Gender, publicName } from '@sde/contracts';

export const ACTIVE_ENTRY_STATUSES: readonly EntryStatus[] = ['PENDING', 'APPROVED'];

export const isActiveEntry = (status: EntryStatus): boolean => ACTIVE_ENTRY_STATUSES.includes(status);

/**
 * Решение по участию: PENDING → APPROVED | REJECTED; отклонённое участие можно одобрить при повторном
 * рассмотрении (REJECTED → PENDING → APPROVED одним решением). Одобренное снимается только командой снятия.
 */
export function decisionAllowed(from: EntryStatus, to: 'APPROVED' | 'REJECTED'): boolean {
  if (from === 'PENDING') return true;
  return from === 'REJECTED' && to === 'APPROVED';
}

export interface SnapshotSource {
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string;
  gender: Gender;
  club: { id: string; name: string; regionId: string | null } | null;
  coachName: string | null;
  personRegionId: string | null;
  rankCode: string | null;
}

export interface EntrySnapshotData {
  snapLastName: string;
  snapFirstName: string;
  snapMiddleName: string | null;
  snapBirthDate: string;
  snapGender: Gender;
  snapClubId: string | null;
  snapClubName: string | null;
  snapCoachName: string | null;
  snapRegionId: string | null;
  snapRankCode: string | null;
  publicName: string;
}

/** Снимок на момент заявки: клуб — основной текущий, регион — спортсмена, иначе клуба. */
export function buildSnapshot(s: SnapshotSource): EntrySnapshotData {
  return {
    snapLastName: s.lastName,
    snapFirstName: s.firstName,
    snapMiddleName: s.middleName,
    snapBirthDate: s.birthDate,
    snapGender: s.gender,
    snapClubId: s.club?.id ?? null,
    snapClubName: s.club?.name ?? null,
    snapCoachName: s.coachName,
    snapRegionId: s.personRegionId ?? s.club?.regionId ?? null,
    snapRankCode: s.rankCode,
    publicName: publicName(s.lastName, s.firstName),
  };
}
