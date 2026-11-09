'use client';
// Вкладка «Заявки» администратора (правки 09.11.2026, п. 3): во время регистрации сюда приходят заявки всех клубов;
// после окончания регистрации здесь же идёт комиссия по допуску — администратор открывает заявку, при необходимости
// смотрит документы каждого спортсмена и нажимает «Одобрить» или «Отказать» с объяснением причины. Когда все заявки
// рассмотрены — «Комиссия пройдена», турнир переходит к взвешиванию.
import {
  APPLICATION_STATUSES,
  type ApplicationDocumentsRow,
  type ApplicationDto,
  type ApplicationSummary,
  type Athlete,
  type Competition,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, Select } from '@sde/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { DocBadge } from '@/features/applications/doc-badge';
import { EntryActions } from '@/features/applications/entry-actions';
import { AthleteDocuments } from '@/features/documents/athlete-documents';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { useCategories } from './categories';
import { NextStageButton } from './next-stage';
import { ApplicationStatusBadge, EntryStatusBadge, formatInZone } from './shared';
import { EntriesTab } from './registrations-tabs';

const DECIDABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'WAITING_DOCUMENTS', 'APPROVED']);

export function CommissionTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('commission');
  const ta = useTranslations('applications');
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'applications' | 'athletes'>('applications');
  const params = { status: status || undefined, q: q.trim() || undefined };
  const list = useInfiniteQuery({
    queryKey: qk.competitionApplications(c.id, params),
    queryFn: ({ pageParam }) =>
      api<Page<ApplicationSummary>>(`/competitions/${c.id}/applications`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = (list.data?.pages.flatMap((p) => p.data) ?? []).filter((a) => a.status !== 'DRAFT');
  const open = rows.filter((a) => a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW').length;
  const mandate = c.status === 'REGISTRATION_CLOSED';
  return (
    <div className="space-y-4">
      {c.status === 'REGISTRATION_OPEN' ? (
        <Alert tone="info">
          {t('registrationOpen', { until: formatInZone(c.registrationEndsAt, c.timezone, locale) })}
        </Alert>
      ) : null}
      {mandate ? (
        <Card className="border-blue-200 bg-blue-50">
          <CardTitle className="mb-1">{t('mandateTitle')}</CardTitle>
          <p className="text-sm text-slate-700">{t('mandateHint')}</p>
          <p className="mt-2 text-sm font-medium">
            {open > 0 ? t('openCount', { count: open }) : t('allReviewed')}
          </p>
          <div className="mt-3">
            <NextStageButton competition={c} to="CHECK_IN" label={t('finish')} />
          </div>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['applications', 'athletes'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            role="tab"
            aria-selected={view === v}
            variant={view === v ? 'primary' : 'secondary'}
            onClick={() => setView(v)}
          >
            {t(`views.${v}`)}
          </Button>
        ))}
      </div>
      {view === 'athletes' ? (
        <EntriesTab competition={c} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="cm-status" label={t('status')}>
              <Select id="cm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('allStatuses')}</option>
                {APPLICATION_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                  <option key={s} value={s}>
                    {ta(`statuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cm-q" label={t('searchClub')}>
              <Input
                id="cm-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={100}
              />
            </Field>
          </div>
          <QueryState isPending={list.isPending} error={list.error}>
            {() =>
              rows.length === 0 ? (
                <EmptyState title={t('empty')} />
              ) : (
                <ul className="space-y-2">
                  {rows.map((a) => (
                    <ApplicationRow key={a.id} competition={c} summary={a} />
                  ))}
                </ul>
              )
            }
          </QueryState>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function ApplicationRow({
  competition: c,
  summary: a,
}: {
  competition: Competition;
  summary: ApplicationSummary;
}) {
  const t = useTranslations('commission');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{a.organization.shortName || a.organization.name}</p>
            <p className="text-sm text-slate-600">
              {a.coach ? `${a.coach.name} · ` : ''}
              {t('counts', {
                total: a.counts.entries,
                approved: a.counts.approved,
                pending: a.counts.pending,
              })}
              {a.submittedAt ? ` · ${formatDateTime(a.submittedAt, locale)}` : ''}
            </p>
          </div>
          <ApplicationStatusBadge status={a.status} />
          <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('close') : t('open')}
          </Button>
        </div>
        {open ? <ApplicationPanel competition={c} applicationId={a.id} /> : null}
      </Card>
    </li>
  );
}

function ApplicationPanel({
  competition: c,
  applicationId,
}: {
  competition: Competition;
  applicationId: string;
}) {
  const t = useTranslations('commission');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useCategories(c.id);
  const action = useAction();
  const app = useQuery({
    queryKey: qk.application(applicationId),
    queryFn: async () => (await api<DataEnvelope<ApplicationDto>>(`/applications/${applicationId}`)).data,
  });
  const docs = useQuery({
    queryKey: [...qk.application(applicationId), 'documents-readiness'],
    queryFn: async () =>
      (
        await api<DataEnvelope<ApplicationDocumentsRow[]>>(
          `/applications/${applicationId}/documents-readiness`,
        )
      ).data,
  });
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.application(applicationId) }),
      queryClient.invalidateQueries({ queryKey: ['competitions', c.id] }),
    ]);
  };
  const decide = async (decision: 'APPROVE' | 'REJECT', reason?: string): Promise<void> => {
    await api(`/applications/${applicationId}/commission`, {
      method: 'POST',
      body: { decision, ...(reason ? { reason } : {}) },
    });
    await refresh();
  };
  const byEntry = new Map((docs.data ?? []).map((d) => [d.entryId, d.documents]));
  const canDecide =
    c.allowedActions.includes('registration.approve') || c.allowedActions.includes('registration.reject');
  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <QueryState isPending={app.isPending} error={app.error}>
        {() => {
          const a = app.data as ApplicationDto;
          const entries = a.entries.filter((e) => e.status !== 'WITHDRAWN');
          return (
            <div className="space-y-3">
              {a.reviewComment ? <Alert tone="info">{t('comment', { text: a.reviewComment })}</Alert> : null}
              {entries.length === 0 ? (
                <p className="text-sm text-slate-600">{t('noAthletes')}</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                  {entries.map((e) => {
                    const d = byEntry.get(e.id);
                    return (
                      <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {[e.snapshot.lastName, e.snapshot.firstName, e.snapshot.middleName]
                              .filter(Boolean)
                              .join(' ')}
                          </p>
                          <p className="text-xs text-slate-600">
                            {formatDate(e.snapshot.birthDate, locale)} · {pickName(e.category.name, locale)}
                          </p>
                          {e.decisionReason ? (
                            <p className="mt-1 text-xs text-slate-600">{e.decisionReason}</p>
                          ) : null}
                        </div>
                        {d ? <DocBadge documents={d} detailed /> : null}
                        <EntryStatusBadge status={e.status} />
                        <EntryActions entry={e} categories={categories.data} onChanged={refresh} />
                        <EntryDocuments athleteId={e.athleteId} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
              {canDecide && DECIDABLE.has(a.status) ? (
                <div className="flex flex-wrap gap-2">
                  {a.status !== 'APPROVED' ? (
                    <Button loading={action.busy} onClick={() => void action.run(() => decide('APPROVE'))}>
                      {t('approve')}
                    </Button>
                  ) : null}
                  <ReasonAction
                    label={t('reject')}
                    title={t('rejectTitle')}
                    description={t('rejectHint')}
                    variant="danger"
                    onConfirm={(reason) => decide('REJECT', reason)}
                  />
                </div>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

/** Документы спортсмена из «Моих документов» — по кнопке, чтобы не грузить все сразу. */
function EntryDocuments({ athleteId }: { athleteId: string }) {
  const t = useTranslations('commission');
  const [open, setOpen] = useState(false);
  const athlete = useQuery({
    queryKey: qk.athlete(athleteId),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${athleteId}`)).data,
    enabled: open,
  });
  return (
    <div className="w-full">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('hideDocuments') : t('documents')}
      </Button>
      {open ? (
        <div className="mt-2">
          <QueryState isPending={athlete.isPending} error={athlete.error}>
            {() => (athlete.data ? <AthleteDocuments athlete={athlete.data} /> : null)}
          </QueryState>
        </div>
      ) : null}
    </div>
  );
}
