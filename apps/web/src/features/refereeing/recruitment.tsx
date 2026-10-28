'use client';
// Открытые наборы судей (правки 27.10.2026): в разделе «Судейство» судья видит, на какие турниры и должности идёт
// набор, требования организатора к каждой должности, и подаёт заявку на должность. Решение принимает организатор.
import type { DataEnvelope, OpenRefereeRecruitmentDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, cn } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/queries';
import { CompetitionStatusBadge, formatDates } from '@/features/competitions/shared';

const OPEN_KEY = ['referee-recruitment', 'open'] as const;
const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

/** Подразделы «Судейства»: мои турниры и открытые наборы (наборы — в роли «Судья»). */
export function RefereeSubnav() {
  const t = useTranslations('recruitment');
  const pathname = usePathname();
  const { data: me } = useMe();
  if (me?.activeRole !== 'REFEREE') return null;
  const items = [
    { href: '/referee', label: t('myCompetitions') },
    { href: '/referee/recruitment', label: t('openTitle') },
  ];
  return (
    <nav
      className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200"
      aria-label={t('sectionsLabel')}
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={pathname === i.href ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium',
            pathname === i.href
              ? 'border-blue-700 text-blue-800'
              : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function OpenRecruitments() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: OPEN_KEY,
    queryFn: async () => (await api<DataEnvelope<OpenRefereeRecruitmentDto[]>>('/referee-recruitment')).data,
  });
  const apply = async (positionId: string): Promise<void> => {
    setError(null);
    setBusy(positionId);
    try {
      const res = await api<DataEnvelope<OpenRefereeRecruitmentDto[]>>(
        `/referee-recruitment/${positionId}/applications`,
        { method: 'POST' },
      );
      queryClient.setQueryData(OPEN_KEY, res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader title={t('referee.title')} description={t('recruitment.openHint')} />
      <RefereeSubnav />
      {error ? (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          (query.data ?? []).length === 0 ? (
            <EmptyState title={t('recruitment.noOpen')} />
          ) : (
            <ul className="grid gap-4">
              {(query.data ?? []).map(({ competition: c, positions }) => (
                <li key={c.id}>
                  <Card>
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold">{c.name}</h2>
                      <CompetitionStatusBadge status={c.status} />
                    </div>
                    <p className="mb-4 text-sm text-slate-600">
                      {formatDates(c.startDate, c.endDate, locale)} · {c.organizer.name}
                      {c.venue ? ` · ${c.venue.city ?? c.venue.name}` : ''}
                    </p>
                    <ul className="divide-y divide-slate-100">
                      {positions.map((p) => (
                        <li key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{t(`roles.${p.roleCode}`)}</p>
                            <p className="text-sm font-medium text-slate-600">
                              {t('recruitment.requirements')}
                            </p>
                            <p className="whitespace-pre-line text-sm">{p.requirements}</p>
                          </div>
                          <div className="shrink-0">
                            {p.myApplication ? (
                              <Badge tone={STATUS_TONE[p.myApplication.status]}>
                                {t(`recruitment.myStatus.${p.myApplication.status}`)}
                              </Badge>
                            ) : (
                              <Button size="sm" loading={busy === p.id} onClick={() => void apply(p.id)}>
                                {t('recruitment.apply')}
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}
