'use client';
// Мастер создания турнира, шаг 1 (API.md, 5.1): организатор, название, сроки в часовом поясе турнира, место и
// правила. Дальше — положение, категории и публикация на странице турнира (контрольный список готовности).
import {
  COMPETITION_LEVELS,
  type Competition,
  type CompetitionCreate,
  type DataEnvelope,
  type RuleSetDto,
  scheduleIssues,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Select } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { OrganizationPicker } from '@/components/organization-picker';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, qk, useDisciplines } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { VenueSelect } from './venue-select';

/** Часовые пояса России (и UTC); турнир может быть и в другом — поле принимает любой пояс IANA. */
export const TIME_ZONES = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'UTC',
];

interface FormValues {
  organizerOrganizationId: string;
  name: string;
  shortName: string;
  disciplineCode: string;
  level: string;
  timezone: string;
  startDate: string;
  endDate: string;
  registrationStartsLocal: string;
  registrationEndsLocal: string;
  venueId: string;
  ruleSetVersionId: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function CompetitionCreateForm() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const tf = useFieldMessage();
  const action = useAction();
  const disciplines = useDisciplines();
  const [v, setV] = useState<FormValues>({
    organizerOrganizationId: '',
    name: '',
    shortName: '',
    disciplineCode: 'SPORT_SAMBO',
    level: 'CLUB',
    timezone: 'Europe/Moscow',
    startDate: '',
    endDate: '',
    registrationStartsLocal: `${today()}T09:00`,
    registrationEndsLocal: '',
    venueId: '',
    ruleSetVersionId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const organizer = v.organizerOrganizationId;
  const rulesets = useQuery({
    queryKey: [...qk.rulesets, v.disciplineCode],
    queryFn: async () =>
      (await api<DataEnvelope<RuleSetDto[]>>('/rulesets', { query: { disciplineCode: v.disciplineCode } }))
        .data,
  });
  const setOrganizer = useCallback((id: string) => setV((x) => ({ ...x, organizerOrganizationId: id })), []);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  const toInstant = (local: string): string | undefined => {
    try {
      return local ? zonedToInstant(local, v.timezone) : undefined;
    } catch {
      return undefined;
    }
  };

  const submit = (): void => {
    const body: Partial<CompetitionCreate> = {
      organizerOrganizationId: organizer,
      name: v.name.trim(),
      shortName: v.shortName.trim() || undefined,
      disciplineCode: v.disciplineCode,
      level: v.level as CompetitionCreate['level'],
      timezone: v.timezone,
      startDate: v.startDate,
      endDate: v.endDate || v.startDate,
      registrationStartsAt: toInstant(v.registrationStartsLocal),
      registrationEndsAt: toInstant(v.registrationEndsLocal),
      venueId: v.venueId || undefined,
      ruleSetVersionId: v.ruleSetVersionId || undefined,
    };
    const local: Record<string, string> = {};
    if (!body.name || body.name.length < 3) local.name = 'too_short';
    if (!body.startDate) local.startDate = 'required';
    if (!body.registrationStartsAt) local.registrationStartsAt = 'required';
    if (!body.registrationEndsAt) local.registrationEndsAt = 'required';
    for (const i of scheduleIssues(body)) local[i.path] = i.code;
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    void action.run(async () => {
      try {
        const res = await api<DataEnvelope<Competition>>('/competitions', { method: 'POST', body });
        router.push(`/competitions/${res.data.id}`);
      } catch (e) {
        if (e instanceof ApiError && e.fields.length > 0) {
          setErrors(Object.fromEntries(e.fields.map((f) => [f.path, f.code])));
          return;
        }
        throw e;
      }
    });
  };

  const versions = (rulesets.data ?? []).flatMap((rs) =>
    rs.versions
      .filter((x) => x.status === 'PUBLISHED')
      .map((x) => ({ id: x.id, label: `${rs.name} · v${x.version}` })),
  );

  return (
    <>
      <PageHeader title={t('competitions.createTitle')} description={t('competitions.createHint')} />
      <form
        noValidate
        className="grid max-w-3xl gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Card>
          <CardTitle>{t('competitions.sectionMain')}</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <OrganizationPicker
              id="c-org"
              label={t('competitions.organizer')}
              permission="competition.create"
              value={organizer}
              onChange={setOrganizer}
              className="sm:col-span-2"
            />
            <Field
              id="c-name"
              label={t('competitions.name')}
              error={tf(errors.name)}
              className="sm:col-span-2"
            >
              <Input id="c-name" value={v.name} onChange={set('name')} maxLength={200} required />
            </Field>
            <Field id="c-short" label={t('competitions.shortName')} hint={t('competitions.shortNameHint')}>
              <Input id="c-short" value={v.shortName} onChange={set('shortName')} maxLength={60} />
            </Field>
            <Field id="c-level" label={t('competitions.level')}>
              <Select id="c-level" value={v.level} onChange={set('level')}>
                {COMPETITION_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`competitions.levels.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="c-discipline" label={t('competitions.discipline')}>
              <Select id="c-discipline" value={v.disciplineCode} onChange={set('disciplineCode')}>
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {pickName(d.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="c-ruleset"
              label={t('competitions.ruleSet')}
              hint={t('competitions.ruleSetHint')}
              error={tf(errors.ruleSetVersionId)}
            >
              <Select id="c-ruleset" value={v.ruleSetVersionId} onChange={set('ruleSetVersionId')}>
                <option value="">{t('competitions.ruleSetLater')}</option>
                {versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
        <ScheduleCard values={v} errors={errors} set={set} />
        <Card>
          <CardTitle>{t('competitions.venue')}</CardTitle>
          {organizer ? (
            <VenueSelect
              organizationId={organizer}
              value={v.venueId}
              timezone={v.timezone}
              error={tf(errors.venueId)}
              onChange={(venueId) => setV((x) => ({ ...x, venueId }))}
            />
          ) : null}
        </Card>
        <div className="flex gap-3">
          <Button type="submit" loading={action.busy} disabled={!organizer}>
            {t('competitions.createSubmit')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/competitions')}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Сроки турнира: даты — календарные в его часовом поясе, окно регистрации — моменты в этом же поясе (ADR-13). */
function ScheduleCard({
  values: v,
  errors,
  set,
}: {
  values: FormValues;
  errors: Record<string, string>;
  set: (k: keyof FormValues) => (e: { target: { value: string } }) => void;
}) {
  const t = useTranslations();
  const tf = useFieldMessage();
  return (
    <Card>
      <CardTitle>{t('competitions.sectionSchedule')}</CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="c-tz"
          label={t('competitions.timezone')}
          hint={t('competitions.timezoneHint')}
          className="sm:col-span-2"
        >
          <Select id="c-tz" value={v.timezone} onChange={set('timezone')}>
            {TIME_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="c-start" label={t('competitions.startDate')} error={tf(errors.startDate)}>
          <Input id="c-start" type="date" value={v.startDate} onChange={set('startDate')} required />
        </Field>
        <Field id="c-end" label={t('competitions.endDate')} error={tf(errors.endDate)}>
          <Input id="c-end" type="date" value={v.endDate} min={v.startDate} onChange={set('endDate')} />
        </Field>
        <Field
          id="c-reg-start"
          label={t('competitions.registrationStartsAt')}
          hint={t('competitions.inTimezone', { tz: v.timezone })}
          error={tf(errors.registrationStartsAt)}
        >
          <Input
            id="c-reg-start"
            type="datetime-local"
            value={v.registrationStartsLocal}
            onChange={set('registrationStartsLocal')}
            required
          />
        </Field>
        <Field
          id="c-reg-end"
          label={t('competitions.registrationEndsAt')}
          hint={t('competitions.inTimezone', { tz: v.timezone })}
          error={tf(errors.registrationEndsAt)}
        >
          <Input
            id="c-reg-end"
            type="datetime-local"
            value={v.registrationEndsLocal}
            onChange={set('registrationEndsLocal')}
            required
          />
        </Field>
      </div>
    </Card>
  );
}
