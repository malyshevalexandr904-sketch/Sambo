'use client';
// Судейство (API.md, 6.3; план Phase 7a, §5): запросы раздела «Судейство», планшета ковра, журнала схватки и
// схваток, ждущих подтверждения. Экраны обновляются опросом (мгновенное обновление — Phase 8).
import type {
  DataEnvelope,
  MatchDetailDto,
  MatchEventDto,
  MatchEventsDto,
  MatConsoleDto,
  OfficiatingDto,
  PendingConfirmationDto,
  ScoringEvent,
} from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const refereeKeys = {
  officiating: (competitionId: string) => ['competitions', competitionId, 'officiating'] as const,
  pending: (competitionId: string) => ['competitions', competitionId, 'pending-confirmations'] as const,
  console: (matId: string) => ['mats', matId, 'console'] as const,
  events: (matchId: string) => ['matches', matchId, 'events'] as const,
};

export function useOfficiating(competitionId: string) {
  return useQuery({
    queryKey: refereeKeys.officiating(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<OfficiatingDto>>(`/competitions/${competitionId}/officiating`)).data,
    refetchInterval: 10_000,
  });
}

export function usePendingConfirmations(competitionId: string) {
  return useQuery({
    queryKey: refereeKeys.pending(competitionId),
    queryFn: async () =>
      (
        await api<DataEnvelope<PendingConfirmationDto[]>>(
          `/competitions/${competitionId}/pending-confirmations`,
        )
      ).data,
    refetchInterval: 10_000,
  });
}

/** Планшет ковра: опрос каждые 5 секунд (второй планшет, вызов пары секретарём, новые схватки ковра). */
export function useMatConsole(matId: string, paused: boolean) {
  return useQuery({
    queryKey: refereeKeys.console(matId),
    queryFn: async () => (await api<DataEnvelope<MatConsoleDto>>(`/mats/${matId}/console`)).data,
    refetchInterval: paused ? false : 5_000,
  });
}

export async function fetchEvents(matchId: string, afterSeq = 0): Promise<MatchEventsDto> {
  return (await api<DataEnvelope<MatchEventsDto>>(`/matches/${matchId}/events`, { query: { afterSeq } }))
    .data;
}

/** Событие журнала с сервера → событие счёта (общий редьюсер packages/contracts). */
export function toScoring(e: MatchEventDto): ScoringEvent {
  return {
    id: e.id,
    seq: e.seq,
    type: e.type,
    side: e.side,
    actionCode: e.actionCode,
    value: e.value,
    matchClockMs: e.matchClockMs,
    deviceTime: e.deviceTime,
    voidsEventId: e.voidsEventId,
  };
}

export function transitionMatch(m: Pick<MatchDetailDto, 'id' | 'version'>, to: string, reason?: string) {
  return api<DataEnvelope<MatchDetailDto>>(`/matches/${m.id}/transitions`, {
    method: 'POST',
    version: m.version,
    body: { to, ...(reason ? { reason } : {}) },
  });
}

export function confirmResult(m: Pick<MatchDetailDto, 'id' | 'version'>) {
  return api<DataEnvelope<MatchDetailDto>>(`/matches/${m.id}/result/confirm`, {
    method: 'POST',
    version: m.version,
  });
}

export function markNoShow(m: Pick<MatchDetailDto, 'id' | 'version'>, side: 'RED' | 'BLUE' | 'BOTH') {
  return api<DataEnvelope<MatchDetailDto>>(`/matches/${m.id}/no-show`, {
    method: 'POST',
    version: m.version,
    body: { side },
  });
}
