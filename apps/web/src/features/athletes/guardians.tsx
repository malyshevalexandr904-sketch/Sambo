'use client';
// Законные представители (API.md, 4.2): добавляет и подтверждает тренер или клуб; приглашение по email
// связывает запись представителя с его аккаунтом.
import {
  type Athlete,
  type DataEnvelope,
  GUARDIAN_RELATIONS,
  GUARDIAN_VERIFICATION_BASES,
  type GuardianSummary,
  isAdultOn,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import {
  emptyPerson,
  fieldErrors,
  PersonFields,
  personPayload,
  type PersonValues,
  withPrefix,
} from '@/components/person-fields';
import { api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export const refreshAthlete = (queryClient: ReturnType<typeof useQueryClient>, id: string): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: qk.athlete(id) });

export function GuardiansPanel({ athlete, editable }: { athlete: Athlete; editable: boolean }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<PersonValues>(emptyPerson());
  const [relation, setRelation] = useState<string>('MOTHER');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAction();
  const [added, setAdded] = useState<string | null>(null);
  const minor = !isAdultOn(athlete.person.birthDate);

  return (
    <Card>
      <CardTitle>{t('guardians.title')}</CardTitle>
      {minor && athlete.guardians.length === 0 ? (
        <Alert tone="warning" className="mb-4">
          {t('guardians.noneForMinor')}
        </Alert>
      ) : null}
      <ul className="mb-4 space-y-4">
        {athlete.guardians.map((g) => (
          <GuardianRow key={g.id} athleteId={athlete.id} guardian={g} editable={editable} />
        ))}
      </ul>
      {added ? (
        <Alert tone="success" className="mb-4">
          {added}
        </Alert>
      ) : null}
      {editable && !adding ? (
        <Button
          variant="secondary"
          onClick={() => {
            setAdded(null);
            setAdding(true);
          }}
        >
          {t('guardians.add')}
        </Button>
      ) : null}
      {editable && adding ? (
        <form
          noValidate
          className="space-y-4 rounded-md border border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            void add.run(async () => {
              try {
                await api<DataEnvelope<GuardianSummary>>(`/athletes/${athlete.id}/guardians`, {
                  method: 'POST',
                  body: {
                    person: personPayload(person),
                    relation,
                    ...(email.trim() ? { email: email.trim() } : {}),
                  },
                });
                setAdding(false);
                setAdded(
                  email.trim() ? t('guardians.addedInvited', { email: email.trim() }) : t('guardians.added'),
                );
                setPerson(emptyPerson());
                setEmail('');
                await refreshAthlete(queryClient, athlete.id);
              } catch (err) {
                setErrors(fieldErrors(err));
                throw err;
              }
            });
          }}
        >
          {add.error ? <Alert tone="danger">{add.error}</Alert> : null}
          <PersonFields
            idPrefix="guardian"
            value={person}
            onChange={setPerson}
            errors={withPrefix(errors, 'person.')}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="guardian-relation" label={t('guardians.relation')} error={tf(errors.relation)}>
              <Select id="guardian-relation" value={relation} onChange={(e) => setRelation(e.target.value)}>
                {GUARDIAN_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`guardians.relations.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="guardian-email"
              label={t('guardians.email')}
              hint={t('guardians.emailHint')}
              error={tf(errors.email)}
            >
              <Input
                id="guardian-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={add.busy}>
              {t('guardians.add')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function GuardianRow({
  athleteId,
  guardian: g,
  editable,
}: {
  athleteId: string;
  guardian: GuardianSummary;
  editable: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [basis, setBasis] = useState<string>('DOCUMENT_SHOWN');
  const [email, setEmail] = useState('');
  const [invited, setInvited] = useState(false);
  const verify = useAction();
  const invite = useAction();
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {g.lastName} {g.firstName} {g.middleName ?? ''}
        </span>
        <span className="text-slate-600">{t(`guardians.relations.${g.relation}`)}</span>
        {g.verifiedAt ? (
          <Badge tone="success">
            <span aria-hidden="true">●</span> {t('guardians.verified')} {formatDate(g.verifiedAt, locale)}
          </Badge>
        ) : (
          <Badge tone="warning">
            <span aria-hidden="true">◐</span> {t('guardians.notVerified')}
          </Badge>
        )}
        {g.hasAccount ? <Badge tone="info">{t('guardians.hasAccount')}</Badge> : null}
      </div>
      {editable ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {!g.verifiedAt ? (
            <>
              <Field id={`basis-${g.id}`} label={t('guardians.basis')}>
                <Select id={`basis-${g.id}`} value={basis} onChange={(e) => setBasis(e.target.value)}>
                  {GUARDIAN_VERIFICATION_BASES.map((b) => (
                    <option key={b} value={b}>
                      {t(`guardians.bases.${b}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                loading={verify.busy}
                onClick={() =>
                  void verify.run(async () => {
                    await api(`/athletes/${athleteId}/guardians/${g.id}/verify`, {
                      method: 'POST',
                      body: { basis },
                    });
                    await refreshAthlete(queryClient, athleteId);
                  })
                }
              >
                {t('guardians.verify')}
              </Button>
            </>
          ) : null}
          {!g.hasAccount ? (
            <>
              <Field id={`invite-${g.id}`} label={t('guardians.inviteEmail')}>
                <Input
                  id={`invite-${g.id}`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={!email.includes('@')}
                loading={invite.busy}
                onClick={() =>
                  void invite.run(async () => {
                    await api(`/athletes/${athleteId}/guardians/${g.id}/invite`, {
                      method: 'POST',
                      body: { email: email.trim() },
                    });
                    setInvited(true);
                    setEmail('');
                  })
                }
              >
                {t('guardians.invite')}
              </Button>
            </>
          ) : null}
          <ReasonAction
            label={t('guardians.end')}
            title={t('guardians.endTitle')}
            size="sm"
            onConfirm={async (reason) => {
              await api(`/athletes/${athleteId}/guardians/${g.id}`, { method: 'DELETE', body: { reason } });
              await refreshAthlete(queryClient, athleteId);
            }}
          />
        </div>
      ) : null}
      {verify.error || invite.error ? (
        <Alert tone="danger" className="mt-2">
          {verify.error ?? invite.error}
        </Alert>
      ) : null}
      {invited ? (
        <Alert tone="success" className="mt-2">
          {t('guardians.invited')}
        </Alert>
      ) : null}
    </li>
  );
}
