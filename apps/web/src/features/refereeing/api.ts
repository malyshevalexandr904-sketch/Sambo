'use client';
// Судейство (API.md, 6.3; план Phase 7a, §5): запросы раздела «Судейство», планшета ковра, журнала схватки и
// схваток, ждущих подтверждения. Экраны обновляются по живым каналам (Phase 8a); опрос — запасной: редкий, пока
// соединение живо, прежний — без него.
import {
  type DataEnvelope,
  liveChannel,
  type MatchDetailDto,
  type MatchEventsDto,
  type MatConsoleDto,
  type OfficiatingDto,
  type PendingConfirmationDto,
} from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLiveInterval, useLiveInvalidate } from '@/lib/live';

export const refereeKeys = {
  officiating: (competitionId: string) => ['competitions', competitionId, 'officiating'] as const,
  pending: (competitionId: string) => ['competitions', competitionId, 'pending-confirmations'] as const,
  console: (matId: string) => ['mats', matId, 'console'] as const,
  events: (matchId: string) => ['matches', matchId, 'events'] as const,
};

export function useOfficiating(competitionId: string) {
  const refetchInterval = useLiveInterval(10_000);
  return useQuery({
    queryKey: refereeKeys.officiating(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<OfficiatingDto>>(`/competitions/${competitionId}/officiating`)).data,
    refetchInterval,
  });
}

export function usePendingConfirmations(competitionId: string) {
  const refetchInterval = useLiveInterval(10_000);
  return useQuery({
    queryKey: refereeKeys.pending(competitionId),
    queryFn: async () =>
      (
        await api<DataEnvelope<PendingConfirmationDto[]>>(
          `/competitions/${competitionId}/pending-confirmations`,
        )
      ).data,
    refetchInterval,
  });
}

/**
 * Планшет ковра: канал ковра — второй планшет, вызов пары секретарём, подтверждение, новые схватки ковра — сразу;
 * без живого соединения — опрос каждые 5 секунд.
 */
export function useMatConsole(matId: string, paused: boolean) {
  const interval = useLiveInterval(5_000);
  useLiveInvalidate(liveChannel.opsMat(matId), () => [refereeKeys.console(matId)]);
  return useQuery({
    queryKey: refereeKeys.console(matId),
    queryFn: async () => (await api<DataEnvelope<MatConsoleDto>>(`/mats/${matId}/console`)).data,
    refetchInterval: paused ? false : interval,
  });
}

export async function fetchEvents(matchId: string, afterSeq = 0): Promise<MatchEventsDto> {
  return (await api<DataEnvelope<MatchEventsDto>>(`/matches/${matchId}/events`, { query: { afterSeq } }))
    .data;
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
