'use client';
// Общее для экранов спортсменов: клубы пользователя с правом, названия разрядов, подписи связей.
import type { Athlete, PermissionCode } from '@sde/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { pickName, qk, useSportRanks } from '@/lib/queries';
import { useOrganizationsWith } from '@/lib/use-orgs';

const CLUB_TYPES = ['CLUB', 'SPORTS_SCHOOL'] as const;

/** Клубы и спортшколы, где у пользователя есть право (платформе — все активные). */
export const useClubsWith = (permission: PermissionCode): ReturnType<typeof useOrganizationsWith> =>
  useOrganizationsWith(permission, CLUB_TYPES);

/** Название разряда ЕВСК по коду — из справочника. */
export function useRankName(): (code: string | null | undefined) => string {
  const locale = useLocale();
  const ranks = useSportRanks();
  return (code) => {
    if (!code) return '—';
    const r = ranks.data?.find((x) => x.code === code);
    return r ? pickName(r.name, locale) : code;
  };
}

export type SetAthlete = (a: Athlete) => void;

export function useAthleteCache(id: string): SetAthlete {
  const queryClient = useQueryClient();
  return (a) => {
    queryClient.setQueryData(qk.athlete(id), a);
    void queryClient.invalidateQueries({ queryKey: ['athletes'], predicate: (q) => q.queryKey[1] !== id });
  };
}
