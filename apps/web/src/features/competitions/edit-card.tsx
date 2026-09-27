'use client';
// Изменение основных данных турнира (API.md, 5.1): у опубликованного турнира изменение сроков требует причины
// и уведомляет участников (competition.dates_changed); запрещённые после публикации поля сервер отклоняет.
import {
  COMPETITION_LEVELS,
  type Competition,
  type CompetitionPatch,
  type DataEnvelope,
  localDateTimeIn,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

const SCHEDULE_KEYS = ['startDate', 'endDate', 'registrationStartsAt', 'registrationEndsAt'] as const;

export function EditCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const action = useAction();
  const initial = {
    name: c.name,
    shortName: c.shortName ?? '',
    level: c.level,
    startDate: c.startDate,
    endDate: c.endDate,
    registrationStartsAt: localDateTimeIn(c.registrationStartsAt, c.timezone),
    registrationEndsAt: localDateTimeIn(c.registrationEndsAt, c.timezone),
    descriptionMd: c.descriptionMd ?? '',
    contactName: c.contactInfo?.name ?? '',
    contactEmail: c.contactInfo?.email ?? '',
    contactPhone: c.contactInfo?.phone ?? '',
    reason: '',
  };
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const scheduleChanged =
    v.startDate !== initial.startDate ||
    v.endDate !== initial.endDate ||
    v.registrationStartsAt !== initial.registrationStartsAt ||
    v.registrationEndsAt !== initial.registrationEndsAt;
  const published = c.status !== 'DRAFT';

  const save = (): void => {
    const patch: CompetitionPatch = {
      name: v.name.trim(),
      shortName: v.shortName.trim() || undefined,
      level: v.level,
      descriptionMd: v.descriptionMd,
      contactInfo: {
        name: v.contactName.trim() || undefined,
        email: v.contactEmail.trim() || undefined,
        phone: v.contactPhone.trim() || undefined,
      },
    };
    if (scheduleChanged) {
      Object.assign(patch, {
        startDate: v.startDate,
        endDate: v.endDate,
        registrationStartsAt: zonedToInstant(v.registrationStartsAt, c.timezone),
        registrationEndsAt: zonedToInstant(v.registrationEndsAt, c.timezone),
      });
      if (published) patch.reason = v.reason.trim();
    }
    setErrors({});
    void action.run(async () => {
      try {
        const res = await api<DataEnvelope<Competition>>(`/competitions/${c.id}`, {
          method: 'PATCH',
          body: patch,
          version: c.version,
        });
        queryClient.setQueryData(qk.competition(c.id), res.data);
        setV((x) => ({ ...x, reason: '' }));
      } catch (e) {
        if (e instanceof ApiError && e.fields.length > 0) {
          setErrors(Object.fromEntries(e.fields.map((f) => [f.path, f.code])));
          return;
        }
        throw e;
      }
    });
  };

  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('competitions.editTitle')}</CardTitle>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {action.error ? (
          <Alert tone="danger" className="sm:col-span-2">
            {action.error}
          </Alert>
        ) : null}
        <Field id="e-name" label={t('competitions.name')} error={tf(errors.name)} className="sm:col-span-2">
          <Input id="e-name" value={v.name} onChange={set('name')} maxLength={200} />
        </Field>
        <Field id="e-short" label={t('competitions.shortName')}>
          <Input id="e-short" value={v.shortName} onChange={set('shortName')} maxLength={60} />
        </Field>
        <Field id="e-level" label={t('competitions.level')}>
          <Select id="e-level" value={v.level} onChange={set('level')}>
            {COMPETITION_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`competitions.levels.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
        {SCHEDULE_KEYS.map((k) => (
          <Field
            key={k}
            id={`e-${k}`}
            label={t(`competitions.${k}`)}
            hint={k.startsWith('registration') ? t('competitions.inTimezone', { tz: c.timezone }) : undefined}
            error={tf(errors[k])}
          >
            <Input
              id={`e-${k}`}
              type={k.startsWith('registration') ? 'datetime-local' : 'date'}
              value={v[k]}
              onChange={set(k)}
            />
          </Field>
        ))}
        {published && scheduleChanged ? (
          <Field
            id="e-reason"
            label={t('competitions.scheduleReason')}
            hint={t('competitions.scheduleReasonHint')}
            className="sm:col-span-2"
          >
            <Textarea id="e-reason" value={v.reason} onChange={set('reason')} maxLength={500} />
          </Field>
        ) : null}
        <Field
          id="e-desc"
          label={t('competitions.description')}
          hint={t('competitions.markdownHint')}
          className="sm:col-span-2"
        >
          <Textarea
            id="e-desc"
            rows={5}
            value={v.descriptionMd}
            onChange={set('descriptionMd')}
            maxLength={20000}
          />
        </Field>
        <Field id="e-cname" label={t('competitions.contactName')}>
          <Input id="e-cname" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field id="e-cemail" label={t('competitions.contactEmail')} error={tf(errors['contactInfo.email'])}>
          <Input id="e-cemail" type="email" value={v.contactEmail} onChange={set('contactEmail')} />
        </Field>
        <Field
          id="e-cphone"
          label={t('competitions.contactPhone')}
          hint={t('competitions.phoneHint')}
          error={tf(errors['contactInfo.phone'])}
        >
          <Input id="e-cphone" type="tel" value={v.contactPhone} onChange={set('contactPhone')} />
        </Field>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={action.busy}
            disabled={published && scheduleChanged && v.reason.trim().length < 5}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
