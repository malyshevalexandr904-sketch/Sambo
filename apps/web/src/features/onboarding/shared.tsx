'use client';
// Общее для регистрации в системе по ролям (Phase 9a): запросы, статусы, тексты ошибок полей заявки. Права и переходы
// решает сервер; интерфейс показывает только то, что разрешено (allowedActions).
import {
  type DataEnvelope,
  type OnboardingCoachOption,
  type OnboardingOrganizationOption,
  type OnboardingOverviewDto,
  type OnboardingRequestDto,
  type OnboardingStatus,
} from '@sde/contracts';
import { Badge } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { api, ApiError } from '@/lib/api';

export const onboardingKeys = {
  overview: ['onboarding', 'me'] as const,
  request: (id: string) => ['onboarding', 'requests', id] as const,
  history: (id: string) => ['onboarding', 'requests', id, 'history'] as const,
  organizations: (q: string) => ['onboarding', 'organizations', q] as const,
  coaches: (organizationId: string) => ['onboarding', 'coaches', organizationId] as const,
  review: (params: object) => ['onboarding', 'review', params] as const,
};

export function useOnboardingOverview() {
  return useQuery({
    queryKey: onboardingKeys.overview,
    queryFn: async () => (await api<DataEnvelope<OnboardingOverviewDto>>('/onboarding/me')).data,
  });
}

export function useOnboardingRequest(id: string) {
  return useQuery({
    queryKey: onboardingKeys.request(id),
    queryFn: async () => (await api<DataEnvelope<OnboardingRequestDto>>(`/onboarding/requests/${id}`)).data,
  });
}

export function useOrganizationOptions(q: string, enabled: boolean) {
  return useQuery({
    queryKey: onboardingKeys.organizations(q),
    queryFn: async () =>
      (
        await api<DataEnvelope<OnboardingOrganizationOption[]>>('/onboarding/organizations', {
          query: { q: q.trim() || undefined },
        })
      ).data,
    enabled,
    staleTime: 60_000,
  });
}

export function useCoachOptions(organizationId: string | null) {
  return useQuery({
    queryKey: onboardingKeys.coaches(organizationId ?? ''),
    queryFn: async () =>
      (
        await api<DataEnvelope<OnboardingCoachOption[]>>(
          `/onboarding/organizations/${organizationId}/coaches`,
        )
      ).data,
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

const TONE: Record<OnboardingStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'info',
  PENDING_ORGANIZATION_APPROVAL: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning',
  CANCELLED: 'neutral',
};
const ICON: Record<OnboardingStatus, string> = {
  DRAFT: '○',
  PENDING_REVIEW: '◐',
  PENDING_ORGANIZATION_APPROVAL: '◐',
  APPROVED: '●',
  REJECTED: '■',
  CHANGES_REQUESTED: '◆',
  CANCELLED: '○',
};

/** Статус — цвет, символ и текст (не только цветом). */
export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  const t = useTranslations('onboarding.statuses');
  return (
    <Badge tone={TONE[status]}>
      <span aria-hidden="true">{ICON[status]}</span>
      {t(status)}
    </Badge>
  );
}

/** Ошибки полей с сервера по путям формы (`organization.inn`, `documents.PASSPORT`). */
export function serverFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fields.map((f) => [f.path, f.code]));
}

/** Текст ошибки поля заявки: сначала формулировки регистрации, затем общие. */
export function useOnboardingFieldMessage(): (code: string | undefined) => string | undefined {
  const t = useTranslations('onboarding.fieldErrors');
  const tf = useTranslations('fields');
  return useCallback(
    (code) => {
      if (!code) return undefined;
      if (t.has(code)) return t(code);
      return tf.has(code) ? tf(code) : tf('invalid');
    },
    [t, tf],
  );
}

/** Подробности ошибки решения: недоступный тренер, организация уже зарегистрирована. */
export function useDecisionErrorDetail(): (error: unknown) => string | null {
  const t = useTranslations('onboarding.preconditions');
  return useCallback(
    (error) => {
      if (!(error instanceof ApiError)) return null;
      const failed = error.details?.failed;
      if (!Array.isArray(failed)) return null;
      const texts = failed
        .filter((f): f is string => typeof f === 'string')
        .map((f) => (t.has(f) ? t(f) : f));
      return texts.length > 0 ? texts.join(' ') : null;
    },
    [t],
  );
}
