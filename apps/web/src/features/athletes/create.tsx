'use client';
// Новый спортсмен (API.md, 4.1): сначала проверка дублей (G-08) — похожие спортсмены показываются
// в публичном виде; создать всё равно можно только с причиной (попадёт в аудит).
import {
  type Athlete,
  type CoachSummary,
  type DataEnvelope,
  type DuplicateCandidate,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
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
import { Link, useRouter } from '@/i18n/navigation';
import { hasOrgRole } from '@/lib/access';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, qk, useMe, useSportRanks } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
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
  const router = useRouter();
  const { data: me } = useMe();
  const clubs = useClubsWith('athlete.create');
  const ranks = useSportRanks();
  const [organizationId, setOrganizationId] = useState('');
  const [person, setPerson] = useState<PersonValues>(emptyPerson());
  const [coachId, setCoachId] = useState('');
  const [rank, setRank] = useState({ code: '', assignedAt: '', orderRef: '' });
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [reason, setReason] = useState('');
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
      const body: Record<string, unknown> = { person: personPayload(person), organizationId };
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
        router.push(`/athletes/${res.data.id}`);
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

  return (
    <>
      <PageHeader title={t('athletes.createTitle')} description={t('athletes.createHint')} />
      {clubs.data.length === 0 && !clubs.isPending ? (
        <Alert tone="warning">{t('athletes.noClubs')}</Alert>
      ) : null}
      {iAmCoach && !me?.personId ? (
        <Alert tone="warning" className="mb-4">
          {t('athletes.coachProfileRequired')}{' '}
          <Link href="/account" className="font-medium underline">
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
        <Button type="submit" size="lg" loading={action.busy} disabled={!organizationId}>
          {t('athletes.create')}
        </Button>
      </form>
    </>
  );
}
