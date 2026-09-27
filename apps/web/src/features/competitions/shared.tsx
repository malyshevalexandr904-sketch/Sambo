'use client';
// Общее для экранов турнира: запросы, бейджи статусов, время в часовом поясе турнира (ADR-13).
import {
  type CategoryWeight,
  type Competition,
  categoryWeightLabel,
  type DataEnvelope,
} from '@sde/contracts';
import { Badge } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

export function useCompetition(id: string) {
  return useQuery({
    queryKey: qk.competition(id),
    queryFn: async () => (await api<DataEnvelope<Competition>>(`/competitions/${id}`)).data,
  });
}

/** Сбросить кэш турнира и всего, что от него зависит (категории, заявки, участники). */
export function useInvalidateCompetition(id: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['competitions', id] });
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const COMPETITION_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  REGISTRATION_OPEN: 'success',
  REGISTRATION_CLOSED: 'warning',
  CHECK_IN: 'info',
  DRAWING: 'info',
  SCHEDULED: 'info',
  IN_PROGRESS: 'info',
  FINISHED: 'neutral',
  ARCHIVED: 'neutral',
  CANCELLED: 'danger',
};

const APPLICATION_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WAITING_DOCUMENTS: 'warning',
  CANCELLED: 'neutral',
  PENDING: 'warning',
  WITHDRAWN: 'neutral',
};

const CATEGORY_TONE: Record<string, Tone> = {
  REGISTRATION: 'success',
  CLOSED: 'warning',
  WEIGH_IN: 'info',
  READY_FOR_DRAW: 'info',
  DRAWN: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'neutral',
  RESULTS_PUBLISHED: 'neutral',
  MERGED: 'neutral',
  CANCELLED: 'danger',
};

const ICON: Record<Tone, string> = { success: '●', warning: '◐', danger: '■', neutral: '○', info: '◆' };

/** Статус — цвет, символ и текст (раздел 40 ТЗ: не только цветом). */
function ToneBadge({ tone, text }: { tone: Tone; text: string }) {
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{ICON[tone]}</span>
      {text}
    </Badge>
  );
}

export function CompetitionStatusBadge({ status }: { status: string }) {
  const t = useTranslations('competitions.statuses');
  return <ToneBadge tone={COMPETITION_TONE[status] ?? 'neutral'} text={t(status)} />;
}

export function CategoryStatusBadge({ status }: { status: string }) {
  const t = useTranslations('competitions.categoryStatuses');
  return <ToneBadge tone={CATEGORY_TONE[status] ?? 'neutral'} text={t(status)} />;
}

export function ApplicationStatusBadge({ status }: { status: string }) {
  const t = useTranslations('applications.statuses');
  return <ToneBadge tone={APPLICATION_TONE[status] ?? 'neutral'} text={t(status)} />;
}

export function EntryStatusBadge({ status }: { status: string }) {
  const t = useTranslations('applications.entryStatuses');
  return <ToneBadge tone={APPLICATION_TONE[status] ?? 'neutral'} text={t(status)} />;
}

/** Момент во времени турнира с подписью часового пояса: «1 нояб. 2026 г., 23:59 (Europe/Moscow)». */
export function formatInZone(iso: string, timeZone: string, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );
  return `${text} (${timeZone})`;
}

/** Календарные даты турнира: «14 нояб. 2026 г.» или «14–15 нояб. 2026 г.». */
export function formatDates(start: string, end: string, locale: string): string {
  const f = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return start === end ? f.format(a) : f.formatRange(a, b);
}

export function useWeightLabel(): (w: CategoryWeight) => string {
  const locale = useLocale();
  return (w) => categoryWeightLabel(w, locale === 'en' ? 'en' : 'ru');
}

/** Понятный текст несовпавших условий перехода: коды из `details.failed` / `details.warnings`. */
export function useFailedText(): (codes: readonly string[]) => string {
  const t = useTranslations('competitions.failed');
  return (codes) => codes.map((c) => (t.has(c) ? t(c) : c)).join('; ');
}
