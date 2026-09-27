'use client';
// Жеребьёвка: запросы, подписи форматов, статусов и кругов (Phase 5a; API.md, 6.1).
import {
  type CategoryBracketDto,
  type CategoryDrawsDto,
  type DataEnvelope,
  type DrawDto,
  type DrawOverviewRow,
  type DrawStatus,
} from '@sde/contracts';
import { Badge } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useFailedText } from '@/features/competitions/shared';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';

export const drawKeys = {
  overview: (competitionId: string) => ['competitions', competitionId, 'draws'] as const,
  category: (categoryId: string) => ['categories', categoryId, 'draws'] as const,
  bracket: (categoryId: string) => ['categories', categoryId, 'bracket'] as const,
  draw: (drawId: string) => ['draws', drawId] as const,
};

export function useDrawOverview(competitionId: string) {
  return useQuery({
    queryKey: drawKeys.overview(competitionId),
    queryFn: async () =>
      (await api<DataEnvelope<DrawOverviewRow[]>>(`/competitions/${competitionId}/draws`)).data,
  });
}

export function useCategoryDraws(categoryId: string) {
  return useQuery({
    queryKey: drawKeys.category(categoryId),
    queryFn: async () => (await api<DataEnvelope<CategoryDrawsDto>>(`/categories/${categoryId}/draws`)).data,
  });
}

export function useDraw(drawId: string | null) {
  return useQuery({
    queryKey: drawKeys.draw(drawId ?? ''),
    enabled: drawId !== null,
    queryFn: async () => (await api<DataEnvelope<DrawDto>>(`/draws/${drawId}`)).data,
  });
}

export function useCategoryBracket(categoryId: string) {
  return useQuery({
    queryKey: drawKeys.bracket(categoryId),
    queryFn: async () =>
      (await api<DataEnvelope<CategoryBracketDto>>(`/categories/${categoryId}/brackets`)).data,
  });
}

/** После команды жеребьёвки: версии, сетка, обзор и категории турнира (статус категории изменился). */
export function useInvalidateDraws(competitionId: string, categoryId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId] }),
      queryClient.invalidateQueries({ queryKey: ['categories', categoryId] }),
      queryClient.invalidateQueries({ queryKey: ['draws'] }),
    ]);
  };
}

const TONE: Record<DrawStatus, 'info' | 'success' | 'neutral'> = {
  DRAFT: 'info',
  PUBLISHED: 'success',
  SUPERSEDED: 'neutral',
};
const ICON: Record<DrawStatus, string> = { DRAFT: '◆', PUBLISHED: '●', SUPERSEDED: '○' };

export function DrawStatusBadge({ status }: { status: DrawStatus }) {
  const t = useTranslations('draws.statuses');
  return (
    <Badge tone={TONE[status]}>
      <span aria-hidden="true">{ICON[status]}</span>
      {t(status)}
    </Badge>
  );
}

export function useFormatLabel(): (format: string | null) => string {
  const t = useTranslations('draws.formats');
  return (format) => (format && t.has(format) ? t(format) : '—');
}

/** Ошибка команды жеребьёвки: текст по коду и несовпавшие условия (`details.failed`). */
export function useCommandError(): (error: unknown) => string {
  const errorMessage = useErrorMessage();
  const failedText = useFailedText();
  return (error) => {
    const failed = error instanceof ApiError ? ((error.details?.failed as string[] | undefined) ?? []) : [];
    return `${errorMessage(error)} ${failedText(failed)}`.trim();
  };
}
