'use client';
// Итоги (план Phase 7b): итоги турнира и категории, публикация, история спортсмена, схватка целиком (изменение
// результата, перенос, отмена, врач на ковре), ручная схватка и данные печатных протоколов.
import type {
  AthleteHistoryDto,
  CategoryProtocolDto,
  CategoryResultsDto,
  CompetitionResultsDto,
  DataEnvelope,
  ManualMatchCreate,
  MatchDetailDto,
  MatchProtocolDto,
  MatchResultAmend,
  MedicalIncidentCreate,
  MedicalIncidentDto,
} from '@sde/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';

export const resultKeys = {
  competition: (competitionId: string) => ['competitions', competitionId, 'results'] as const,
  category: (categoryId: string) => ['categories', categoryId, 'results'] as const,
  history: (athleteId: string) => ['athletes', athleteId, 'history'] as const,
  match: (matchId: string) => ['matches', matchId] as const,
  incidents: (matchId: string) => ['matches', matchId, 'medical-incidents'] as const,
  matchProtocol: (matchId: string) => ['matches', matchId, 'protocol'] as const,
  categoryProtocol: (categoryId: string) => ['categories', categoryId, 'protocol'] as const,
};

export function useCompetitionResults(competitionId: string) {
  return useQuery({
    queryKey: resultKeys.competition(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<CompetitionResultsDto>>(`/competitions/${competitionId}/results`)).data,
    refetchInterval: 15_000,
  });
}

export function useCategoryResults(categoryId: string, enabled = true) {
  return useQuery({
    queryKey: resultKeys.category(categoryId),
    enabled,
    queryFn: async () =>
      (await api<DataEnvelope<CategoryResultsDto>>(`/categories/${categoryId}/results`)).data,
  });
}

export function useAthleteHistory(athleteId: string) {
  return useQuery({
    queryKey: resultKeys.history(athleteId),
    queryFn: async () => (await api<DataEnvelope<AthleteHistoryDto>>(`/athletes/${athleteId}/history`)).data,
  });
}

/** Схватка целиком; идущая — опрос каждые 5 секунд (врач на ковре, счёт). */
export function useMatch(matchId: string) {
  return useQuery({
    queryKey: resultKeys.match(matchId),
    queryFn: async () => (await api<DataEnvelope<MatchDetailDto>>(`/matches/${matchId}`)).data,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'IN_PROGRESS' || s === 'PAUSED' || s === 'READY' ? 5_000 : 15_000;
    },
  });
}

/** Записи врача с заметками — только медицинскому персоналу (чтение — в журнал доступа). */
export function useMatchIncidents(matchId: string, enabled: boolean) {
  return useQuery({
    queryKey: resultKeys.incidents(matchId),
    enabled,
    queryFn: async () =>
      (await api<DataEnvelope<MedicalIncidentDto[]>>(`/matches/${matchId}/medical-incidents`)).data,
  });
}

export function useMatchProtocol(matchId: string) {
  return useQuery({
    queryKey: resultKeys.matchProtocol(matchId),
    queryFn: async () => (await api<DataEnvelope<MatchProtocolDto>>(`/matches/${matchId}/protocol`)).data,
    staleTime: Infinity,
  });
}

export function useCategoryProtocol(categoryId: string) {
  return useQuery({
    queryKey: resultKeys.categoryProtocol(categoryId),
    queryFn: async () =>
      (await api<DataEnvelope<CategoryProtocolDto>>(`/categories/${categoryId}/protocol`)).data,
    staleTime: Infinity,
  });
}

export function publishResults(c: Pick<CategoryResultsDto, 'categoryId' | 'version'>) {
  return api<DataEnvelope<CategoryResultsDto>>(`/categories/${c.categoryId}/results/publish`, {
    method: 'POST',
    body: {},
    version: c.version,
  });
}

export function amendResult(m: Pick<MatchDetailDto, 'id' | 'version'>, body: MatchResultAmend) {
  return api<DataEnvelope<MatchDetailDto>>(`/matches/${m.id}/result/amend`, {
    method: 'POST',
    body,
    version: m.version,
  });
}

export function recordIncident(matchId: string, body: MedicalIncidentCreate) {
  return api<DataEnvelope<MatchDetailDto>>(`/matches/${matchId}/medical-incidents`, {
    method: 'POST',
    body,
  });
}

export function createManualMatch(categoryId: string, body: ManualMatchCreate) {
  return api<DataEnvelope<MatchDetailDto>>(`/categories/${categoryId}/matches`, { method: 'POST', body });
}

/** После команды по итогам: итоги, сетки, схватки, судейство и история — всё, что могло измениться. */
export function useInvalidateResults(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['competitions'] }),
      qc.invalidateQueries({ queryKey: ['categories'] }),
      qc.invalidateQueries({ queryKey: ['matches'] }),
      qc.invalidateQueries({ queryKey: ['draws'] }),
      qc.invalidateQueries({ queryKey: ['athletes'] }),
      qc.invalidateQueries({ queryKey: ['mats'] }),
    ]);
  }, [qc]);
}
