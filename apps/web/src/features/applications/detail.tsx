'use client';
// Заявка клуба на турнир (API.md, 5.3; C-02). Владелец собирает состав: спортсмен клуба → категории,
// в которые он проходит (совместимость и причины отказа считает сервер), заявленный вес — по желанию.
// Персонал турнира рассматривает заявку: решения по каждому участнику, возврат на исправление с комментарием.
import type { ApplicationDto, DataEnvelope, EntryDto } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, PageHeader, Table, Td, Th } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { useCategories } from '@/features/competitions/categories';
import { ApplicationStatusBadge, EntryStatusBadge } from '@/features/competitions/shared';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { AddEntryCard } from './add-entry';
import { EntryQr } from '@/features/operations/entry-qr';
import { AdmissionSummaryView } from '@/features/operations/shared';
import { EntryActions } from './entry-actions';

/** Переходы, для которых сервер требует комментарий (попадает клубу). */
const COMMENT_REQUIRED = new Set(['REJECTED', 'WAITING_DOCUMENTS']);

export function ApplicationPage({ id }: { id: string }) {
  const t = useTranslations('applications');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: qk.application(id),
    queryFn: async () => (await api<DataEnvelope<ApplicationDto>>(`/applications/${id}`)).data,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.application(id) });
    if (q.data) await queryClient.invalidateQueries({ queryKey: ['competitions', q.data.competition.id] });
    await queryClient.invalidateQueries({ queryKey: ['me', 'applications'] });
  };
  return (
    <QueryState
      isPending={q.isPending}
      error={q.error instanceof ApiError && q.error.status === 404 ? null : q.error}
    >
      {() =>
        !q.data ? (
          <EmptyState title={t('notFound')}>
            <Link href="/applications" className="text-blue-700 underline">
              {t('backToList')}
            </Link>
          </EmptyState>
        ) : (
          <>
            <PageHeader
              title={q.data.organization.name}
              description={
                <>
                  <Link href={`/competitions/${q.data.competition.id}`} className="text-blue-700 underline">
                    {q.data.competition.name}
                  </Link>
                  {' · '}
                  {formatDate(q.data.competition.startDate, locale)}
                </>
              }
              actions={<ApplicationStatusBadge status={q.data.status} />}
            />
            <div className="space-y-6">
              <SummaryCard application={q.data} onChanged={refresh} />
              {q.data.canAddEntries ? <AddEntryCard application={q.data} onAdded={refresh} /> : null}
              <EntriesCard application={q.data} onChanged={refresh} />
            </div>
          </>
        )
      }
    </QueryState>
  );
}

function SummaryCard({
  application: a,
  onChanged,
}: {
  application: ApplicationDto;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('applications');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = a.allowedActions.filter((x) => x.startsWith('transition:')).map((x) => x.slice(11));
  /** Ошибку перехода с комментарием показывает сама форма комментария; для кнопки — карточка. */
  const transition = async (to: string, comment?: string): Promise<void> => {
    await api(`/applications/${a.id}/transitions`, {
      method: 'POST',
      body: { to, comment },
      version: a.version,
    });
    await onChanged();
  };
  const press = async (to: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await transition(to);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle>{t('summaryTitle')}</CardTitle>
      {a.reviewComment && (a.status === 'WAITING_DOCUMENTS' || a.status === 'REJECTED') ? (
        <Alert tone={a.status === 'REJECTED' ? 'danger' : 'warning'} className="mb-3">
          <p className="font-medium">{t(a.status === 'REJECTED' ? 'rejectedComment' : 'returnedComment')}</p>
          <p className="whitespace-pre-line">{a.reviewComment}</p>
        </Alert>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-600">{t('coach')}</dt>
          <dd>{a.coach?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('representation')}</dt>
          <dd>
            {[
              a.representation.organization?.name,
              a.representation.region ? pickName(a.representation.region.name, locale) : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('athletes')}</dt>
          <dd>
            {t('counts', {
              total: a.counts.entries,
              approved: a.counts.approved,
              pending: a.counts.pending,
              rejected: a.counts.rejected,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('submittedAt')}</dt>
          <dd>{a.submittedAt ? formatDateTime(a.submittedAt, locale) : '—'}</dd>
        </div>
      </dl>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {targets.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {targets.map((to) =>
            COMMENT_REQUIRED.has(to) || to === 'CANCELLED' ? (
              <ReasonAction
                key={to}
                variant={to === 'REJECTED' || to === 'CANCELLED' ? 'danger' : 'secondary'}
                label={t(`transitionTo.${to}`)}
                title={t(`transitionTitle.${to}`)}
                required={COMMENT_REQUIRED.has(to)}
                onConfirm={(comment) => transition(to, comment || undefined)}
              />
            ) : (
              <Button
                key={to}
                variant={to === 'SUBMITTED' || to === 'APPROVED' ? 'primary' : 'secondary'}
                loading={busy}
                onClick={() => void press(to)}
              >
                {t(`transitionTo.${to}`)}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {a.status === 'DRAFT' && a.counts.entries === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t('emptyDraftHint')}</p>
      ) : null}
    </Card>
  );
}

function EntriesCard({
  application: a,
  onChanged,
}: {
  application: ApplicationDto;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('applications');
  const locale = useLocale();
  const weight = (g: number | null): string =>
    g === null ? '—' : `${String(g / 1000).replace('.', locale === 'ru' ? ',' : '.')} ${t('kg')}`;
  const needCategories = a.entries.some((e) => e.allowedActions.includes('entry.transfer'));
  const categories = useCategoriesIf(a.competition.id, needCategories);
  return (
    <Card>
      <CardTitle>{t('entriesTitle')}</CardTitle>
      {a.entries.length === 0 ? (
        <p className="text-sm text-slate-600">{t('noEntries')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('athlete')}</Th>
              <Th>{t('category')}</Th>
              <Th>{t('declaredWeight')}</Th>
              <Th>{t('status')}</Th>
              <Th>{t('actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {a.entries.map((e: EntryDto) => (
              <tr key={e.id}>
                <Td>
                  <p className="font-medium">{e.publicName}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(e.snapshot.birthDate, locale)}
                    {e.snapshot.rankCode ? ` · ${e.snapshot.rankCode}` : ''}
                  </p>
                </Td>
                <Td>{pickName(e.category.name, locale)}</Td>
                <Td>{weight(e.declaredWeightGrams)}</Td>
                <Td>
                  <EntryStatusBadge status={e.status} />
                  {e.decisionReason ? (
                    <p className="mt-1 text-xs text-slate-600">{e.decisionReason}</p>
                  ) : null}
                  {e.withdrawReason ? (
                    <p className="mt-1 text-xs text-slate-600">{e.withdrawReason}</p>
                  ) : null}
                  {e.admission ? (
                    <div className="mt-1">
                      <AdmissionSummaryView summary={e.admission} />
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <EntryActions entry={e} categories={categories} onChanged={onChanged} />
                  {e.status === 'APPROVED' ? (
                    <div className="mt-2">
                      <EntryQr entryId={e.id} />
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function useCategoriesIf(competitionId: string, enabled: boolean) {
  const q = useCategories(competitionId, enabled);
  return enabled ? q.data : undefined;
}
