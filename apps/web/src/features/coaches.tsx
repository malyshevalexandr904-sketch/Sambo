'use client';
// Тренеры организации (API.md, 4.3): профиль тренера — для участника с ролью «Тренер» или для человека
// без аккаунта; работа в клубе — периодом.
import {
  type CoachSummary,
  type DataEnvelope,
  type Membership,
  type Page,
  PROFILE_STATUSES,
} from '@sde/contracts';
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import {
  emptyPerson,
  fieldErrors,
  PersonFields,
  personPayload,
  type PersonValues,
  withPrefix,
} from '@/components/person-fields';
import { useClubsWith } from '@/features/athletes/shared';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function Coaches() {
  const t = useTranslations();
  const clubs = useClubsWith('coach.manage');
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  useEffect(() => {
    if (!organizationId && clubs.data[0]) setOrganizationId(clubs.data[0].id);
  }, [clubs.data, organizationId]);
  const params = { organizationId, status, limit: 100 };
  const coaches = useQuery({
    queryKey: qk.coaches(params),
    queryFn: () => api<Page<CoachSummary>>('/coaches', { query: params }),
    enabled: organizationId !== '',
  });
  return (
    <>
      <PageHeader title={t('coaches.title')} description={t('coaches.hint')} />
      {clubs.data.length === 0 && !clubs.isPending ? (
        <Alert tone="warning">{t('athletes.noClubs')}</Alert>
      ) : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:w-2/3">
        <Select
          aria-label={t('athletes.club')}
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
        >
          {clubs.data.map((o) => (
            <option key={o.id} value={o.id}>
              {o.shortName}
            </option>
          ))}
        </Select>
        <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          {PROFILE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      {organizationId ? (
        <div className="space-y-6">
          <QueryState isPending={coaches.isPending} error={coaches.error}>
            {() =>
              (coaches.data?.data ?? []).length === 0 ? (
                <EmptyState title={t('common.noData')}>{t('coaches.empty')}</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('athletes.name')}</Th>
                      <Th>{t('coaches.organizations')}</Th>
                      <Th>{t('coaches.account')}</Th>
                      <Th>{t('common.status')}</Th>
                      <Th>{t('common.actions')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(coaches.data?.data ?? []).map((c) => (
                      <CoachRow key={c.id} coach={c} organizationId={organizationId} />
                    ))}
                  </tbody>
                </Table>
              )
            }
          </QueryState>
          <CoachCreateForm organizationId={organizationId} />
        </div>
      ) : null}
    </>
  );
}

function CoachRow({ coach: c, organizationId }: { coach: CoachSummary; organizationId: string }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const action = useAction();
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['coaches'] });
  return (
    <tr>
      <Td className="font-medium">{c.name}</Td>
      <Td>{c.organizations.map((o) => o.shortName).join(', ') || '—'}</Td>
      <Td>{c.userId ? t('common.yes') : t('common.no')}</Td>
      <Td>
        <StatusBadge status={c.status} />
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          {c.organizations.some((o) => o.id === organizationId) ? (
            <Button
              size="sm"
              variant="ghost"
              loading={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api(`/coaches/${c.id}/end-membership`, { method: 'POST', body: { organizationId } });
                  await refresh();
                })
              }
            >
              {t('coaches.endMembership')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            loading={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/coaches/${c.id}`, {
                  method: 'PATCH',
                  version: c.version,
                  body: { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                });
                await refresh();
              })
            }
          >
            {c.status === 'ACTIVE' ? t('coaches.deactivate') : t('coaches.activate')}
          </Button>
        </div>
        {action.error ? <p className="mt-1 text-sm text-red-700">{action.error}</p> : null}
      </Td>
    </tr>
  );
}

function CoachCreateForm({ organizationId }: { organizationId: string }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'member' | 'person'>('member');
  const [userId, setUserId] = useState('');
  const [person, setPerson] = useState<PersonValues>(emptyPerson());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [done, setDone] = useState(false);
  const action = useAction();
  const members = useQuery({
    queryKey: qk.members(organizationId),
    queryFn: () =>
      api<Page<Membership>>(`/organizations/${organizationId}/members`, { query: { limit: 100 } }),
  });
  const coachMembers = (members.data?.data ?? []).filter(
    (m) => m.roleCode === 'COACH' && m.status === 'ACTIVE' && m.user,
  );

  const submit = (confirm: boolean): void => {
    setErrors({});
    setDone(false);
    void action.run(async () => {
      try {
        await api<DataEnvelope<CoachSummary>>('/coaches', {
          method: 'POST',
          body:
            mode === 'member'
              ? { organizationId, userId }
              : {
                  organizationId,
                  person: personPayload(person),
                  ...(confirm ? { confirmNotDuplicate: true } : {}),
                },
        });
        setDuplicate(false);
        setDone(true);
        setPerson(emptyPerson());
        setUserId('');
        await queryClient.invalidateQueries({ queryKey: ['coaches'] });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
          setDuplicate(true);
          return;
        }
        setErrors(fieldErrors(e));
        throw e;
      }
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardTitle>{t('coaches.add')}</CardTitle>
      <fieldset className="mb-4 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">{t('coaches.add')}</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="coach-mode"
            checked={mode === 'member'}
            onChange={() => setMode('member')}
          />
          {t('coaches.fromMembers')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="coach-mode"
            checked={mode === 'person'}
            onChange={() => setMode('person')}
          />
          {t('coaches.withoutAccount')}
        </label>
      </fieldset>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        {done ? <Alert tone="success">{t('coaches.added')}</Alert> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {mode === 'member' ? (
          <Field
            id="coach-user"
            label={t('coaches.member')}
            hint={t('coaches.memberHint')}
            error={tf(errors.userId)}
          >
            <Select id="coach-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">—</option>
              {coachMembers.map((m) => (
                <option key={m.id} value={m.user?.id ?? ''}>
                  {m.user?.displayName} {m.user?.email ? `(${m.user.email})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <PersonFields
            idPrefix="coach"
            value={person}
            onChange={setPerson}
            errors={withPrefix(errors, 'person.')}
          />
        )}
        {duplicate ? (
          <Alert tone="warning">
            {t('coaches.duplicate')}
            <div className="mt-3">
              <Button type="button" variant="secondary" loading={action.busy} onClick={() => submit(true)}>
                {t('coaches.createAnyway')}
              </Button>
            </div>
          </Alert>
        ) : null}
        <Button type="submit" loading={action.busy} disabled={mode === 'member' && !userId}>
          {t('coaches.add')}
        </Button>
      </form>
    </Card>
  );
}
