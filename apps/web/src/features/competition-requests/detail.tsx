'use client';
// Заявка на проведение турнира: предложение организации и решение платформы. Одобрение создаёт черновик
// рейтингового турнира — администратор продолжает подготовку на его странице (правила, категории, публикация).
import {
  type CompetitionRequestDto,
  type DataEnvelope,
  type HostingContact,
  hostingContactHref,
  type HostingResponsible,
  stageOfCompetition,
  type TournamentStage,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, PageHeader } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState, ReasonAction } from '@/components/common';
import { MarkdownLite } from '@/components/markdown-lite';
import { formatDates, formatInZone } from '@/features/competitions/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { GeneratedRegulationCard } from '@/features/competitions/generated-regulation';
import { RecruitmentSummary } from '@/features/competitions/recruitment';
import { EquipmentList, RefereeList } from './form-parts';
import { StageStepper } from '@/features/tournament/stage-stepper';
import { RequestStatusBadge } from './shared';

/** Стадия по заявке: черновик, на согласовании (подана или турнир ещё не опубликован), дальше — стадия турнира. */
function stageOfRequest(r: CompetitionRequestDto): TournamentStage | null {
  if (r.status === 'DRAFT') return 'DRAFT';
  if (r.status === 'SUBMITTED') return 'REVIEW';
  if (r.status === 'APPROVED' && r.competition) return stageOfCompetition(r.competition.status);
  return null;
}

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
  const command = async (path: 'approve' | 'withdraw' | 'reject' | 'publish', body?: object) => {
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
        {stageOfRequest(r) ? (
          <Card>
            <StageStepper stage={stageOfRequest(r)} variant="manage" />
          </Card>
        ) : null}
        {r.status === 'DRAFT' ? (
          <Alert tone="info" title={t('competitionRequests.draftTitle')}>
            <p>{t('competitionRequests.draftText')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/competition-requests/new?draft=${r.id}`}
                className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
              >
                {t('competitionRequests.continueDraft')}
              </Link>
              {r.allowedActions.includes('discard') ? (
                <Button
                  variant="ghost"
                  loading={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (!window.confirm(t('competitionRequests.discardConfirm'))) return;
                      await api(`/competition-requests/${r.id}/discard`, { method: 'POST' });
                      await refresh();
                      router.push('/competitions');
                    })
                  }
                >
                  {t('competitionRequests.discardDraft')}
                </Button>
              ) : null}
            </div>
          </Alert>
        ) : null}
        {r.status === 'APPROVED' && r.competitionId && r.competition?.status === 'DRAFT' ? (
          <Alert tone="success" title={t('competitionRequests.approvedTitle')}>
            <p>{t('competitionRequests.approvedText')}</p>
            {r.allowedActions.includes('publish') ? (
              <div className="mt-3 rounded-md border border-green-300 p-3">
                <p className="font-medium">{t('competitionRequests.publishTitle')}</p>
                <p className="mt-1 text-sm">{t('competitionRequests.publishText')}</p>
                <Button
                  className="mt-3"
                  loading={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (!window.confirm(t('competitionRequests.publishConfirm'))) return;
                      await command('publish');
                    })
                  }
                >
                  {t('competitionRequests.publish')}
                </Button>
              </div>
            ) : null}
            <Link
              href={`/competitions/${r.competitionId}`}
              className="mt-3 inline-block font-medium underline"
            >
              {t('competitionRequests.openCompetition')}
            </Link>
          </Alert>
        ) : null}
        {r.status === 'APPROVED' && r.competition && r.competition.status !== 'DRAFT' ? (
          <Alert tone="success" title={t('competitionRequests.publishedTitle')}>
            <p>{t('competitionRequests.publishedText')}</p>
            <div className="mt-2 flex flex-wrap gap-4">
              <Link href={`/tournaments/${r.competition.slug}`} className="font-medium underline">
                {t('competitionRequests.openPublic')}
              </Link>
              <Link href={`/competitions/${r.competition.id}`} className="font-medium underline">
                {t('competitionRequests.openCompetition')}
              </Link>
            </div>
          </Alert>
        ) : null}
        {r.status === 'REJECTED' ? (
          <Alert tone="danger" title={t('competitionRequests.rejectedTitle')}>
            {r.decisionReason}
          </Alert>
        ) : null}
        {r.status === 'SUBMITTED' || r.status === 'APPROVED' ? (
          <GeneratedRegulationCard href={`/api/v1/competition-requests/${r.id}/regulation.pdf`} draft />
        ) : null}
        <Card>
          <CardTitle>{t('competitionRequests.proposal')}</CardTitle>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-600">{t('competitionRequests.organization')}</dt>
            <dd>{r.organization.name}</dd>
            <dt className="text-slate-600">{t('competitions.dates')}</dt>
            <dd>{formatDates(r.startDate, r.endDate, locale)}</dd>
            {p.address ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.address')}</dt>
                <dd className="whitespace-pre-line">{p.address}</dd>
              </>
            ) : (
              <>
                <dt className="text-slate-600">{t('competitions.venue')}</dt>
                <dd>
                  {r.venue
                    ? [r.venue.name, r.venue.city, r.venue.address].filter(Boolean).join(', ')
                    : t('competitionRequests.noVenue')}
                </dd>
              </>
            )}
            {r.ageGroups.length > 0 ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.ageGroups')}</dt>
                <dd>{r.ageGroups.map((g) => pickName(g.name, locale)).join(', ')}</dd>
              </>
            ) : null}
            {p.gender ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.gender')}</dt>
                <dd>{t(`competitionRequests.genders.${p.gender}`)}</dd>
              </>
            ) : null}
            {p.matCount ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.matCount')}</dt>
                <dd>{p.matCount}</dd>
              </>
            ) : null}
            {p.equipment ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.equipment')}</dt>
                <dd>{t(`competitionRequests.availability.${p.equipment}`)}</dd>
              </>
            ) : null}
            {p.refereeTeam ? (
              <>
                <dt className="text-slate-600">{t('competitionRequests.refereeTeam')}</dt>
                <dd>{t(`competitionRequests.availability.${p.refereeTeam}`)}</dd>
              </>
            ) : null}
            {p.registrationStartsAt && p.registrationEndsAt ? (
              <>
                <dt className="text-slate-600">{t('competitions.registrationStartsAt')}</dt>
                <dd>{formatInZone(p.registrationStartsAt, p.timezone, locale)}</dd>
                <dt className="text-slate-600">{t('competitions.registrationEndsAt')}</dt>
                <dd>{formatInZone(p.registrationEndsAt, p.timezone, locale)}</dd>
                <dt className="text-slate-600">{t('competitions.level')}</dt>
                <dd>{t(`competitions.levels.${r.level}`)}</dd>
              </>
            ) : null}
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
        {p.contact ? <ContactCard contact={p.contact} /> : null}
        {p.responsible ? <ResponsibleCard responsible={p.responsible} /> : null}
        {r.requirements && p.matCount ? (
          <Card>
            <CardTitle>{t('competitionRequests.requirements')}</CardTitle>
            <EquipmentList req={r.requirements} mats={p.matCount} />
            <RefereeList req={r.requirements} mats={p.matCount} groups={r.ageGroups.length} />
          </Card>
        ) : null}
        <RecruitmentSummary positions={p.refereeRecruitment ?? []} />
        {r.allowedActions.some((a) => a === 'approve' || a === 'reject' || a === 'withdraw') ? (
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

/** Способ связи с организатором, выбранный в заявке (правки 07.11.2026, п. 11). */
function ContactCard({ contact }: { contact: HostingContact }) {
  const t = useTranslations('competitionRequests');
  const href = hostingContactHref(contact);
  return (
    <Card>
      <CardTitle>{t('contactMethod')}</CardTitle>
      <p className="text-sm text-slate-600">{t(`contactChannels.${contact.channel}`)}</p>
      <p className="mt-1 font-medium">
        {href ? (
          <a
            className="text-blue-700 underline"
            href={href}
            {...(href.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {contact.value}
          </a>
        ) : (
          contact.value
        )}
      </p>
    </Card>
  );
}

/** Ответственный за проведение — с кем связывается администратор платформы. */
function ResponsibleCard({ responsible: r }: { responsible: HostingResponsible }) {
  const t = useTranslations('competitionRequests');
  const name = r.kind === 'CONTACT' ? r.fullName : r.displayName;
  return (
    <Card>
      <CardTitle>{t('responsible')}</CardTitle>
      <p className="text-sm text-slate-600">{t(`responsibleShown.${r.kind}`)}</p>
      <p className="mt-2 font-medium">{name}</p>
      <ul className="mt-1 text-sm">
        {r.phone ? (
          <li>
            <a className="text-blue-700 underline" href={`tel:${r.phone}`}>
              {r.phone}
            </a>
          </li>
        ) : null}
        {r.email ? (
          <li>
            <a className="text-blue-700 underline" href={`mailto:${r.email}`}>
              {r.email}
            </a>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
