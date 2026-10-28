'use client';
// Новый спортсмен (API.md, 4.1): сначала проверка дублей (G-08) — похожие спортсмены показываются
// в публичном виде; создать всё равно можно только с причиной (попадёт в аудит).
// Мастер в два шага: данные спортсмена, затем согласия и документы — тренер вносит всё сам.
// Данные вносит не субъект ПДн, поэтому автор подтверждает согласие спортсмена или представителя (152-ФЗ).
import {
  type Athlete,
  type CoachSummary,
  type DataEnvelope,
  type DuplicateCandidate,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  emptyPerson,
  fieldErrors,
  PersonFields,
  personPayload,
  type PersonValues,
  withPrefix,
} from '@/components/person-fields';
import { QueryState } from '@/components/common';
import { AthleteDocuments } from '@/features/documents/athlete-documents';
import { Link } from '@/i18n/navigation';
import { hasOrgRole } from '@/lib/access';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, qk, useMe, useSportRanks } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { ConsentsPanel } from './consents';
import { useClubsWith } from './shared';

export function DuplicateList({ candidates }: { candidates: DuplicateCandidate[] }) {
  const t = useTranslations('athletes');
  const locale = useLocale();
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {candidates.map((c) => (
        <li key={c.athleteId}>
          <span className="font-medium">{c.publicName}</span>, {c.birthYear} · {c.clubShortName ?? '—'}
          {c.regionName ? ` · ${pickName(c.regionName, locale)}` : ''} ·{' '}
          {t('similarity', { value: Math.round(c.similarity * 100) })}
        </li>
      ))}
    </ul>
  );
}

export function AthleteCreate() {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const clubs = useClubsWith('athlete.create');
  const ranks = useSportRanks();
  const [organizationId, setOrganizationId] = useState('');
  const [person, setPerson] = useState<PersonValues>(emptyPerson());
  const [coachId, setCoachId] = useState('');
  const [rank, setRank] = useState({ code: '', assignedAt: '', orderRef: '' });
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [reason, setReason] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();

  useEffect(() => {
    if (!organizationId && clubs.data[0]) setOrganizationId(clubs.data[0].id);
  }, [clubs.data, organizationId]);

  const coaches = useQuery({
    queryKey: qk.coaches({ organizationId }),
    queryFn: () =>
      api<Page<CoachSummary>>('/coaches', { query: { organizationId, limit: 100, status: 'ACTIVE' } }),
    enabled: organizationId !== '',
  });
  const iAmCoach = hasOrgRole(me, organizationId, 'COACH');

  const submit = async (confirm: boolean): Promise<void> => {
    setErrors({});
    await action.run(async () => {
      const body: Record<string, unknown> = {
        person: personPayload(person),
        organizationId,
        thirdPartyConsentConfirmed: consentConfirmed,
      };
      if (coachId) body.coachId = coachId;
      if (rank.code)
        body.rank = {
          sportRankCode: rank.code,
          assignedAt: rank.assignedAt,
          ...(rank.orderRef ? { orderRef: rank.orderRef } : {}),
        };
      if (confirm && candidates)
        body.confirmNotDuplicate = { candidateIds: candidates.map((c) => c.athleteId), reason };
      try {
        const res = await api<DataEnvelope<Athlete>>('/athletes', { method: 'POST', body });
        queryClient.setQueryData(qk.athlete(res.data.id), res.data);
        void queryClient.invalidateQueries({ queryKey: ['athletes'] });
        setCreatedId(res.data.id);
        window.scrollTo({ top: 0 });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
          setCandidates((e.details?.candidates as DuplicateCandidate[] | undefined) ?? []);
          return;
        }
        setErrors(fieldErrors(e));
        throw e;
      }
    });
  };

  const reset = (): void => {
    setCreatedId(null);
    setPerson(emptyPerson());
    setRank({ code: '', assignedAt: '', orderRef: '' });
    setCandidates(null);
    setReason('');
    setConsentConfirmed(false);
    setErrors({});
    window.scrollTo({ top: 0 });
  };

  if (createdId) return <AthleteDocumentsStep id={createdId} onAnother={reset} />;

  return (
    <>
      <PageHeader
        title={t('athletes.createTitle')}
        description={
          <>
            <span className="block font-medium">{t('athletes.wizard.step1')}</span>
            {t('athletes.createHint')}
          </>
        }
      />
      {clubs.data.length === 0 && !clubs.isPending ? (
        <Alert tone="warning">{t('athletes.noClubs')}</Alert>
      ) : null}
      {iAmCoach && !me?.personId ? (
        <Alert tone="warning" className="mb-4">
          {t('athletes.coachProfileRequired')}{' '}
          <Link href="/admin" className="font-medium underline">
            {t('nav.account')}
          </Link>
        </Alert>
      ) : null}
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Card>
          <CardTitle>{t('athletes.club')}</CardTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="organizationId" label={t('athletes.club')} error={tf(errors.organizationId)}>
              <Select
                id="organizationId"
                value={organizationId}
                onChange={(e) => {
                  setOrganizationId(e.target.value);
                  setCoachId('');
                }}
              >
                {clubs.data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="coachId"
              label={t('athletes.coach')}
              hint={iAmCoach ? t('athletes.coachSelfHint') : undefined}
              error={tf(errors.coachId)}
            >
              <Select id="coachId" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
                <option value="">{iAmCoach ? t('athletes.coachSelf') : '—'}</option>
                {(coaches.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <CardTitle>{t('athletes.personTitle')}</CardTitle>
          <PersonFields
            idPrefix="athlete"
            value={person}
            onChange={(v) => {
              setPerson(v);
              setCandidates(null);
            }}
            errors={withPrefix(errors, 'person.')}
          />
        </Card>
        <Card>
          <CardTitle>{t('athletes.rank')}</CardTitle>
          <div className="grid gap-4 md:grid-cols-3">
            <Field id="rankCode" label={t('athletes.rank')}>
              <Select
                id="rankCode"
                value={rank.code}
                onChange={(e) => setRank({ ...rank, code: e.target.value })}
              >
                <option value="">{t('athletes.noRank')}</option>
                {(ranks.data ?? []).map((r) => (
                  <option key={r.code} value={r.code}>
                    {pickName(r.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="rankAssignedAt"
              label={t('athletes.rankAssignedAt')}
              error={tf(errors['rank.assignedAt'])}
            >
              <Input
                id="rankAssignedAt"
                type="date"
                disabled={!rank.code}
                value={rank.assignedAt}
                onChange={(e) => setRank({ ...rank, assignedAt: e.target.value })}
              />
            </Field>
            <Field id="rankOrderRef" label={t('athletes.rankOrderRef')}>
              <Input
                id="rankOrderRef"
                disabled={!rank.code}
                value={rank.orderRef}
                onChange={(e) => setRank({ ...rank, orderRef: e.target.value })}
              />
            </Field>
          </div>
        </Card>
        {candidates ? (
          <Alert tone="warning" title={t('athletes.duplicatesTitle')}>
            {t('athletes.duplicatesHint')}
            <DuplicateList candidates={candidates} />
            <Field id="dup-reason" label={t('common.reason')} hint={t('common.reasonHint')} className="mt-3">
              <Textarea
                id="dup-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button
              type="button"
              className="mt-3"
              variant="secondary"
              disabled={reason.trim().length < 5}
              loading={action.busy}
              onClick={() => void submit(true)}
            >
              {t('athletes.createAnyway')}
            </Button>
          </Alert>
        ) : null}
        <div>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
            />
            <span>
              {t.rich('athletes.wizard.consentConfirm', {
                consent: (chunks) => (
                  <Link
                    href="/personal-data-consent"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>
        </div>
        <Button type="submit" size="lg" loading={action.busy} disabled={!organizationId || !consentConfirmed}>
          {t('athletes.wizard.next')}
        </Button>
      </form>
    </>
  );
}

/** Шаг 2: согласия (скан бумажного согласия) и документы только что добавленного спортсмена. */
function AthleteDocumentsStep({ id, onAnother }: { id: string; onAnother: () => void }) {
  const t = useTranslations();
  const query = useQuery({
    queryKey: qk.athlete(id),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${id}`)).data,
  });
  return (
    <>
      <PageHeader
        title={t('athletes.wizard.step2Title')}
        description={<span className="block font-medium">{t('athletes.wizard.step2')}</span>}
      />
      <QueryState isPending={query.isPending} error={query.error}>
        {() => {
          const a = query.data as Athlete;
          return (
            <div className="space-y-6">
              <Alert tone="success">
                {t('athletes.wizard.created', { name: `${a.person.lastName} ${a.person.firstName}` })}
              </Alert>
              <div className="grid gap-6 xl:grid-cols-2">
                <ConsentsPanel athlete={a} />
                {a.allowedActions.includes('document.view') ? <AthleteDocuments athlete={a} /> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/athletes/${a.id}`}
                  className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {t('athletes.wizard.done')}
                </Link>
                <Button variant="secondary" onClick={onAnother}>
                  {t('athletes.wizard.another')}
                </Button>
              </div>
              <p className="text-sm text-slate-600">{t('athletes.wizard.later')}</p>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
