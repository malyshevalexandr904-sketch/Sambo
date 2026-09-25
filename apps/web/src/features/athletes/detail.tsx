'use client';
// Карточка спортсмена (API.md, 4.1): данные, клуб и тренер, разряды, представители, согласия, документы.
// Доступные действия приходят с сервера (allowedActions): интерфейс лишь скрывает недоступное.
import { type Athlete, type DataEnvelope, fullName } from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, PageHeader } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { QueryState, ReasonAction, StatusBadge } from '@/components/common';
import { fieldErrors, PersonFields, type PersonValues, withPrefix } from '@/components/person-fields';
import { AthleteDocuments } from '@/features/documents/athlete-documents';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { ConsentsPanel } from './consents';
import { GuardiansPanel } from './guardians';
import { ClubPanel, RanksPanel } from './links';
import { useAthleteCache } from './shared';

export function AthleteDetail({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const query = useQuery({
    queryKey: qk.athlete(id),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${id}`)).data,
  });
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => {
        const a = query.data as Athlete;
        const can = (action: string): boolean => a.allowedActions.includes(action);
        return (
          <>
            <PageHeader
              title={fullName(a.person)}
              description={
                <>
                  {t('athletes.publicId')}: <span className="font-mono">{a.publicId}</span> ·{' '}
                  {a.currentClub?.shortName ?? t('athletes.noClub')}
                  {a.currentRank ? ` · ${pickName(a.currentRank.name, locale)}` : ''}
                </>
              }
              actions={
                <div className="flex items-center gap-2">
                  {a.relation ? <Badge tone="info">{t(`athletes.relation.${a.relation}`)}</Badge> : null}
                  <StatusBadge status={a.status} />
                </div>
              }
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <PersonPanel athlete={a} editable={can('athlete.update')} />
              <ClubPanel athlete={a} editable={can('athlete.update')} />
              <RanksPanel athlete={a} editable={can('athlete.update')} />
              <GuardiansPanel athlete={a} editable={can('guardian.manage')} />
              <ConsentsPanel athlete={a} />
              {can('document.view') ? <AthleteDocuments athlete={a} /> : null}
              {can('athlete.archive') || can('athlete.merge') ? <AdminPanel athlete={a} /> : null}
            </div>
          </>
        );
      }}
    </QueryState>
  );
}

function PersonPanel({ athlete, editable }: { athlete: Athlete; editable: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const setAthlete = useAthleteCache(athlete.id);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<PersonValues>(toValues(athlete));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  useEffect(() => setValue(toValues(athlete)), [athlete]);
  const p = athlete.person;
  return (
    <Card>
      <CardTitle>{t('athletes.personTitle')}</CardTitle>
      {!editing ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-600">{t('people.lastName')}</dt>
            <dd>{p.lastName}</dd>
            <dt className="text-slate-600">{t('people.firstName')}</dt>
            <dd>{p.firstName}</dd>
            <dt className="text-slate-600">{t('people.middleName')}</dt>
            <dd>{p.middleName ?? '—'}</dd>
            <dt className="text-slate-600">{t('people.birthDate')}</dt>
            <dd>{formatDate(p.birthDate, locale)}</dd>
            <dt className="text-slate-600">{t('people.gender')}</dt>
            <dd>{t(`people.genders.${p.gender}`)}</dd>
          </dl>
          {editable ? (
            <Button variant="secondary" className="mt-4" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          ) : null}
        </>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            void action.run(async () => {
              try {
                const res = await api<DataEnvelope<Athlete>>(`/athletes/${athlete.id}`, {
                  method: 'PATCH',
                  version: athlete.version,
                  body: {
                    person: {
                      lastName: value.lastName.trim(),
                      firstName: value.firstName.trim(),
                      middleName: value.middleName.trim() || null,
                      birthDate: value.birthDate,
                      gender: value.gender,
                    },
                  },
                });
                setAthlete(res.data);
                setEditing(false);
              } catch (e) {
                setErrors(withPrefix(fieldErrors(e), 'person.'));
                throw e;
              }
            });
          }}
        >
          {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
          <PersonFields idPrefix="athlete-edit" value={value} onChange={setValue} errors={errors} />
          <div className="flex gap-2">
            <Button type="submit" loading={action.busy}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

const toValues = (a: Athlete): PersonValues => ({
  lastName: a.person.lastName,
  firstName: a.person.firstName,
  middleName: a.person.middleName ?? '',
  birthDate: a.person.birthDate,
  gender: a.person.gender,
});

function AdminPanel({ athlete }: { athlete: Athlete }) {
  const t = useTranslations();
  const router = useRouter();
  const setAthlete = useAthleteCache(athlete.id);
  const [targetId, setTargetId] = useState('');
  const can = (a: string): boolean => athlete.allowedActions.includes(a);
  return (
    <Card>
      <CardTitle>{t('athletes.adminTitle')}</CardTitle>
      <div className="space-y-4">
        {can('athlete.archive') && athlete.status !== 'ARCHIVED' ? (
          <ReasonAction
            label={t('athletes.archive')}
            title={t('athletes.archiveTitle')}
            description={t('athletes.archiveHint')}
            variant="danger"
            onConfirm={async (reason) => {
              const res = await api<DataEnvelope<Athlete>>(`/athletes/${athlete.id}/archive`, {
                method: 'POST',
                body: { reason },
              });
              setAthlete(res.data);
            }}
          />
        ) : null}
        {can('athlete.merge') ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{t('athletes.mergeHint')}</p>
            <Field id="merge-target" label={t('athletes.mergeTarget')}>
              <Input
                id="merge-target"
                value={targetId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => setTargetId(e.target.value.trim())}
              />
            </Field>
            {/^[0-9a-f-]{36}$/i.test(targetId) ? (
              <ReasonAction
                label={t('athletes.merge')}
                title={t('athletes.mergeTitle')}
                description={t('athletes.mergeWarning')}
                variant="danger"
                onConfirm={async (reason) => {
                  const res = await api<DataEnvelope<Athlete>>('/admin/athletes/merge', {
                    method: 'POST',
                    body: { sourceAthleteId: athlete.id, targetAthleteId: targetId, reason },
                  });
                  router.push(`/athletes/${res.data.id}`);
                }}
              />
            ) : null}
            <p className="text-xs text-slate-500">
              {t('athletes.thisId')}: <span className="font-mono">{athlete.id}</span>
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
