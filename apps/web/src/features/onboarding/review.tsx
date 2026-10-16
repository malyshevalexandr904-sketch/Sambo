'use client';
// Проверка заявок на регистрацию (Phase 9a): очередь с фильтрами по роли, статусу и дате; карточка с данными,
// документами (временные ссылки), возможными дублями и историей; одобрение, отказ и запрос исправлений с причиной.
// Что видит и что может пользователь, решает сервер: платформа, руководитель организации, тренер с правом.
import {
  type DataEnvelope,
  ONBOARDING_ROLES,
  ONBOARDING_STATUSES,
  type OnboardingRequestDto,
  type Page,
} from '@sde/contracts';
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  Textarea,
} from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  onboardingKeys,
  OnboardingStatusBadge,
  useDecisionErrorDetail,
  useOnboardingRequest,
} from './shared';
import { RequestHistory, RequestSummary } from './summary';

export function ReviewQueue() {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pending = status === 'PENDING';
  const params = {
    role: role || undefined,
    status: pending ? undefined : status || undefined,
    pending: pending || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 100,
  };
  const queue = useQuery({
    queryKey: onboardingKeys.review(params),
    queryFn: () => api<Page<OnboardingRequestDto>>('/onboarding/review', { query: params }),
  });
  const rows = queue.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('review.title')} description={t('review.lead')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="f-role" label={t('fields.role')}>
          <Select id="f-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{tc('all')}</option>
            {ONBOARDING_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-status" label={tc('status')}>
          <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">{t('review.awaiting')}</option>
            <option value="">{tc('all')}</option>
            {ONBOARDING_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-from" label={t('review.from')}>
          <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="f-to" label={t('review.to')}>
          <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <QueryState isPending={queue.isPending} error={queue.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('review.empty')}>{t('review.emptyHint')}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('fields.applicant')}</Th>
                  <Th>{t('fields.role')}</Th>
                  <Th>{t('fields.organization')}</Th>
                  <Th>{tc('status')}</Th>
                  <Th>{t('review.submittedAt')}</Th>
                  <Th>{tc('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">
                      {[r.lastName, r.firstName].filter(Boolean).join(' ') || r.applicant?.displayName}
                    </Td>
                    <Td>
                      {t(`roles.${r.role}`)}
                      {r.kind === 'JOIN_ORGANIZATION' ? ` · ${t('kinds.JOIN_ORGANIZATION')}` : ''}
                    </Td>
                    <Td>{r.organization?.shortName ?? r.newOrganization?.name ?? t('fields.independent')}</Td>
                    <Td>
                      <OnboardingStatusBadge status={r.status} />
                    </Td>
                    <Td>{r.submittedAt ? formatDateTime(r.submittedAt, locale) : '—'}</Td>
                    <Td>
                      <Link href={`/onboarding/review/${r.id}`} className="text-blue-700 hover:underline">
                        {tc('details')}
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </>
  );
}

export function ReviewDetail({ id }: { id: string }) {
  const t = useTranslations('onboarding');
  const request = useOnboardingRequest(id);
  return (
    <QueryState isPending={request.isPending} error={request.error}>
      {() =>
        request.data ? (
          <>
            <PageHeader
              title={t('review.cardTitle', { role: t(`roles.${request.data.role}`) })}
              actions={
                <Link
                  href="/onboarding/review"
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
                >
                  {t('review.back')}
                </Link>
              }
            />
            <div className="space-y-6">
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="mb-0">{t('status.data')}</CardTitle>
                  <OnboardingStatusBadge status={request.data.status} />
                </div>
                {request.data.applicant ? (
                  <p className="mb-3 text-sm text-slate-600">
                    {t('review.account', {
                      name: request.data.applicant.displayName,
                      email: request.data.applicant.email ?? '—',
                    })}
                  </p>
                ) : null}
                {request.data.possibleDuplicates ? (
                  <Alert tone="warning" className="mb-3">
                    {t('review.duplicates', { count: request.data.possibleDuplicates })}
                  </Alert>
                ) : null}
                {request.data.decisionReason ? (
                  <p className="mb-3 text-sm">
                    {t('history.reason', { reason: request.data.decisionReason })}
                  </p>
                ) : null}
                <RequestSummary request={request.data} />
              </Card>
              <Decision request={request.data} />
              <RequestHistory requestId={id} />
            </div>
          </>
        ) : null
      }
    </QueryState>
  );
}

function Decision({ request: r }: { request: OnboardingRequestDto }) {
  const t = useTranslations('onboarding');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const detail = useDecisionErrorDetail();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r.allowedActions.includes('approve')) return null;
  const done = async (res: DataEnvelope<OnboardingRequestDto>): Promise<void> => {
    queryClient.setQueryData(onboardingKeys.request(r.id), res.data);
    await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
  };
  const describe = (e: unknown): string => [errorMessage(e), detail(e)].filter(Boolean).join(' ');
  const run = (action: 'reject' | 'request-changes') => async (reason: string) => {
    const res = await api<DataEnvelope<OnboardingRequestDto>>(`/onboarding/requests/${r.id}/${action}`, {
      method: 'POST',
      version: r.version,
      body: { reason },
    });
    await done(res);
  };
  return (
    <Card>
      <CardTitle>{t('review.decision')}</CardTitle>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Field id="approve-comment" label={t('review.comment')} hint={t('review.commentHint')}>
        <Textarea
          id="approve-comment"
          value={comment}
          maxLength={500}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api<DataEnvelope<OnboardingRequestDto>>(
                `/onboarding/requests/${r.id}/approve`,
                {
                  method: 'POST',
                  version: r.version,
                  body: comment.trim() ? { comment: comment.trim() } : {},
                },
              );
              await done(res);
            } catch (e) {
              setError(describe(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('review.approve')}
        </Button>
        <ReasonAction
          label={t('review.requestChanges')}
          title={t('review.requestChangesTitle')}
          describeError={describe}
          onConfirm={run('request-changes')}
        />
        <ReasonAction
          label={t('review.reject')}
          title={t('review.rejectTitle')}
          variant="danger"
          describeError={describe}
          onConfirm={run('reject')}
        />
      </div>
    </Card>
  );
}
