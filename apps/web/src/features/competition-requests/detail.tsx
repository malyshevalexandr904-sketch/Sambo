'use client';
// Заявка на проведение турнира: предложение организации и решение платформы. Одобрение создаёт черновик
// рейтингового турнира — администратор продолжает подготовку на его странице (правила, категории, публикация).
import type { CompetitionRequestDto, DataEnvelope } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, PageHeader } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState, ReasonAction } from '@/components/common';
import { MarkdownLite } from '@/components/markdown-lite';
import { formatDates, formatInZone } from '@/features/competitions/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { RequestStatusBadge } from './shared';

export function CompetitionRequestDetail({ id }: { id: string }) {
  const t = useTranslations('competitionRequests');
  const query = useQuery({
    queryKey: ['competition-requests', 'one', id],
    queryFn: async () => (await api<DataEnvelope<CompetitionRequestDto>>(`/competition-requests/${id}`)).data,
  });
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => (query.data ? <RequestView request={query.data} /> : <p>{t('empty')}</p>)}
    </QueryState>
  );
}

function RequestView({ request: r }: { request: CompetitionRequestDto }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const action = useAction();
  const p = r.proposal;
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['competition-requests'] });
  };
  const command = async (path: 'approve' | 'withdraw' | 'reject', body?: object) => {
    const res = await api<DataEnvelope<CompetitionRequestDto>>(`/competition-requests/${r.id}/${path}`, {
      method: 'POST',
      version: r.version,
      ...(body ? { body } : {}),
    });
    await refresh();
    return res.data;
  };
  return (
    <>
      <PageHeader
        title={r.name}
        description={t('competitionRequests.fromOrganization', { name: r.organization.name })}
        actions={<RequestStatusBadge status={r.status} />}
      />
      <div className="grid max-w-3xl gap-6">
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {r.status === 'APPROVED' && r.competitionId ? (
          <Alert tone="success" title={t('competitionRequests.approvedTitle')}>
            {t('competitionRequests.approvedText')}{' '}
            <Link href={`/competitions/${r.competitionId}`} className="font-medium underline">
              {t('competitionRequests.openCompetition')}
            </Link>
          </Alert>
        ) : null}
        {r.status === 'REJECTED' ? (
          <Alert tone="danger" title={t('competitionRequests.rejectedTitle')}>
            {r.decisionReason}
          </Alert>
        ) : null}
        <Card>
          <CardTitle>{t('competitionRequests.proposal')}</CardTitle>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-600">{t('competitionRequests.organization')}</dt>
            <dd>{r.organization.name}</dd>
            <dt className="text-slate-600">{t('competitions.dates')}</dt>
            <dd>{formatDates(r.startDate, r.endDate, locale)}</dd>
            <dt className="text-slate-600">{t('competitions.registrationStartsAt')}</dt>
            <dd>{formatInZone(p.registrationStartsAt, p.timezone, locale)}</dd>
            <dt className="text-slate-600">{t('competitions.registrationEndsAt')}</dt>
            <dd>{formatInZone(p.registrationEndsAt, p.timezone, locale)}</dd>
            <dt className="text-slate-600">{t('competitions.level')}</dt>
            <dd>{t(`competitions.levels.${r.level}`)}</dd>
            <dt className="text-slate-600">{t('competitions.venue')}</dt>
            <dd>
              {r.venue
                ? [r.venue.name, r.venue.city, r.venue.address].filter(Boolean).join(', ')
                : t('competitionRequests.noVenue')}
            </dd>
            {r.expectedParticipants ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.expectedParticipants')}</dt>
                <dd>{r.expectedParticipants}</dd>
              </>
            ) : null}
            {r.submittedBy ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.submittedBy')}</dt>
                <dd>{r.submittedBy.displayName}</dd>
              </>
            ) : null}
          </dl>
          {p.descriptionMd ? (
            <div className="mt-4 text-sm">
              <MarkdownLite text={p.descriptionMd} />
            </div>
          ) : null}
          {r.comment ? (
            <p className="mt-4 whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-medium">{t('competitionRequests.comment')}: </span>
              {r.comment}
            </p>
          ) : null}
        </Card>
        {r.allowedActions.length > 0 ? (
          <div className="flex flex-wrap items-start gap-3">
            {r.allowedActions.includes('approve') ? (
              <Button
                loading={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const done = await command('approve');
                    if (done.competitionId) router.push(`/competitions/${done.competitionId}`);
                  })
                }
              >
                {t('competitionRequests.approve')}
              </Button>
            ) : null}
            {r.allowedActions.includes('reject') ? (
              <ReasonAction
                label={t('competitionRequests.reject')}
                title={t('competitionRequests.rejectTitle')}
                variant="danger"
                onConfirm={async (reason) => {
                  await command('reject', { reason });
                }}
              />
            ) : null}
            {r.allowedActions.includes('withdraw') ? (
              <Button
                variant="secondary"
                loading={action.busy}
                onClick={() => void action.run(() => command('withdraw'))}
              >
                {t('competitionRequests.withdraw')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
