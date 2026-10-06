'use client';
// Расписание турнира (API.md, 6.2; план Phase 6): запросы ковров, сессий, расписания, бригад и очереди ковра.
import {
  type CrewCandidateDto,
  type DataEnvelope,
  type MatAssignmentDto,
  type MatDto,
  type MatQueueDto,
  type ScheduleDto,
  type ScheduleSessionDto,
} from '@sde/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';

export const schedulingKeys = {
  mats: (competitionId: string) => ['competitions', competitionId, 'mats'] as const,
  sessions: (competitionId: string) => ['competitions', competitionId, 'sessions'] as const,
  schedule: (competitionId: string) => ['competitions', competitionId, 'schedule'] as const,
  crews: (competitionId: string) => ['competitions', competitionId, 'mat-assignments'] as const,
  crewCandidates: (competitionId: string) => ['competitions', competitionId, 'crew-candidates'] as const,
  matQueue: (matId: string) => ['mats', matId, 'queue'] as const,
};

export function useMats(competitionId: string) {
  return useQuery({
    queryKey: schedulingKeys.mats(competitionId),
    queryFn: async () => (await api<DataEnvelope<MatDto[]>>(`/competitions/${competitionId}/mats`)).data,
  });
}

export function useSessions(competitionId: string) {
  return useQuery({
    queryKey: schedulingKeys.sessions(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<ScheduleSessionDto[]>>(`/competitions/${competitionId}/sessions`)).data,
  });
}

export function useSchedule(competitionId: string) {
  return useQuery({
    queryKey: schedulingKeys.schedule(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<ScheduleDto>>(`/competitions/${competitionId}/schedule`)).data,
  });
}

export function useCrews(competitionId: string) {
  return useQuery({
    queryKey: schedulingKeys.crews(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<MatAssignmentDto[]>>(`/competitions/${competitionId}/mat-assignments`)).data,
  });
}

export function useCrewCandidates(competitionId: string) {
  return useQuery({
    queryKey: schedulingKeys.crewCandidates(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<CrewCandidateDto[]>>(`/competitions/${competitionId}/crew-candidates`)).data,
  });
}

/** Экран ковра «Ковры» (кворум зала): обновляется каждые 15 секунд, пока экран открыт. */
export function useMatQueue(matId: string) {
  return useQuery({
    queryKey: schedulingKeys.matQueue(matId),
    queryFn: async () => (await api<DataEnvelope<MatQueueDto>>(`/mats/${matId}/queue`)).data,
    refetchInterval: 15_000,
  });
}

export function useInvalidateScheduling(competitionId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId, 'mats'] }),
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId, 'sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId, 'schedule'] }),
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId, 'mat-assignments'] }),
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId] }),
    ]);
  };
}

/** Время матча/сессии в часовом поясе турнира, только часы:минуты. */
export function timeInZone(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(new Date(iso));
}

/**
 * Название круга схватки для интерфейса (`bracket.rounds.*`: «Четвертьфинал», «За 3-е место»…). `roundLabel`
 * приходит с сервера кодом (FINAL, QUARTERFINAL, REPECHAGE…); незнакомый код показываем как есть, а не ключом.
 */
export function useRoundLabel(): (label: string) => string {
  const t = useTranslations('bracket.rounds');
  return (label) => (t.has(label) ? t(label) : label);
}

/** Предупреждения пакета правки (savable с confirm: true) и запреты — разные типы ошибок команды. */
export function scheduleWarnings(
  error: unknown,
): { matchId: string; kind: string; shortfallSeconds: number }[] {
  if (!(error instanceof ApiError) || error.code !== 'SCHEDULE_CONFIRM_REQUIRED') return [];
  const warnings = error.details?.warnings;
  return Array.isArray(warnings)
    ? (warnings as { matchId: string; kind: string; shortfallSeconds: number }[])
    : [];
}
