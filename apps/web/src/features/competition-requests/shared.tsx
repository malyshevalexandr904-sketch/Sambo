'use client';
import type { CompetitionRequestStatus } from '@sde/contracts';
import { Badge } from '@sde/ui';
import { useTranslations } from 'next-intl';

const TONE = {
  SUBMITTED: { tone: 'warning', icon: '◐' },
  APPROVED: { tone: 'success', icon: '●' },
  REJECTED: { tone: 'danger', icon: '■' },
  WITHDRAWN: { tone: 'neutral', icon: '○' },
} as const;

/** Статус заявки — цвет, символ и текст. */
export function RequestStatusBadge({ status }: { status: CompetitionRequestStatus }) {
  const t = useTranslations('competitionRequests.statuses');
  const s = TONE[status];
  return (
    <Badge tone={s.tone}>
      <span aria-hidden="true">{s.icon}</span>
      {t(status)}
    </Badge>
  );
}
