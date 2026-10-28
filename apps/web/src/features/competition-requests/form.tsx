'use client';
// Заявка организации на проведение турнира (docs/RATED_ONLY.md, 2): турнир создаёт только администратор платформы,
// организация предлагает название, сроки и место. После одобрения появляется черновик рейтингового турнира.
import {
  COMPETITION_LEVELS,
  type CompetitionRequestCreate,
  type CompetitionRequestDto,
  type DataEnvelope,
  scheduleIssues,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { OrganizationPicker } from '@/components/organization-picker';
import { ScheduleCard, type ScheduleValues, today } from '@/features/competitions/create';
import {
  emptyRecruitment,
  type RecruitmentDraft,
  RecruitmentDraftCard,
  recruitmentBody,
  recruitmentIssues,
} from '@/features/competitions/recruitment';
import { VenueSelect } from '@/features/competitions/venue-select';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, useDisciplines } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

interface FormValues extends ScheduleValues {
  organizationId: string;
  name: string;
  shortName: string;
  disciplineCode: string;
  level: string;
  venueId: string;
  expectedParticipants: string;
  descriptionMd: string;
  comment: string;
}

export function CompetitionRequestForm() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const tf = useFieldMessage();
  const action = useAction();
  const queryClient = useQueryClient();
  const disciplines = useDisciplines();
  const [v, setV] = useState<FormValues>({
    organizationId: '',
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
    expectedParticipants: '',
    descriptionMd: '',
    comment: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recruitment, setRecruitment] = useState<RecruitmentDraft>(emptyRecruitment);
  const setOrganization = useCallback((id: string) => setV((x) => ({ ...x, organizationId: id })), []);
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
    const participants = Number(v.expectedParticipants);
    const body: Partial<CompetitionRequestCreate> = {
      organizationId: v.organizationId,
      name: v.name.trim(),
      shortName: v.shortName.trim() || undefined,
      disciplineCode: v.disciplineCode,
      level: v.level as CompetitionRequestCreate['level'],
      timezone: v.timezone,
      startDate: v.startDate,
      endDate: v.endDate || v.startDate,
      registrationStartsAt: toInstant(v.registrationStartsLocal),
      registrationEndsAt: toInstant(v.registrationEndsLocal),
      venueId: v.venueId || undefined,
      expectedParticipants:
        v.expectedParticipants && Number.isInteger(participants) ? participants : undefined,
      descriptionMd: v.descriptionMd.trim() || undefined,
      comment: v.comment.trim() || undefined,
      refereeRecruitment: recruitmentBody(recruitment),
    };
    const local: Record<string, string> = recruitmentIssues(recruitment);
    if (!body.name || body.name.length < 3) local.name = 'too_short';
    if (!body.startDate) local.startDate = 'required';
    if (!body.registrationStartsAt) local.registrationStartsAt = 'required';
    if (!body.registrationEndsAt) local.registrationEndsAt = 'required';
    for (const i of scheduleIssues(body)) local[i.path] = i.code;
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    void action.run(async () => {
      try {
        const res = await api<DataEnvelope<CompetitionRequestDto>>('/competition-requests', {
          method: 'POST',
          body,
        });
        await queryClient.invalidateQueries({ queryKey: ['competition-requests'] });
        router.push(`/competition-requests/${res.data.id}`);
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
    <>
      <PageHeader title={t('competitionRequests.newTitle')} description={t('competitionRequests.newHint')} />
      <form
        noValidate
        className="grid max-w-3xl gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Alert tone="info">{t('competitionRequests.formatNote')}</Alert>
        <Card>
          <CardTitle>{t('competitions.sectionMain')}</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <OrganizationPicker
              id="r-org"
              label={t('competitionRequests.organization')}
              permission="competition.request"
              value={v.organizationId}
              onChange={setOrganization}
              className="sm:col-span-2"
            />
            <Field
              id="r-name"
              label={t('competitions.name')}
              error={tf(errors.name)}
              className="sm:col-span-2"
            >
              <Input id="r-name" value={v.name} onChange={set('name')} maxLength={200} required />
            </Field>
            <Field id="r-short" label={t('competitions.shortName')} hint={t('competitions.shortNameHint')}>
              <Input id="r-short" value={v.shortName} onChange={set('shortName')} maxLength={60} />
            </Field>
            <Field id="r-level" label={t('competitions.level')}>
              <Select id="r-level" value={v.level} onChange={set('level')}>
                {COMPETITION_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`competitions.levels.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="r-discipline" label={t('competitions.discipline')}>
              <Select id="r-discipline" value={v.disciplineCode} onChange={set('disciplineCode')}>
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {pickName(d.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="r-participants"
              label={t('competitionRequests.expectedParticipants')}
              error={tf(errors.expectedParticipants)}
            >
              <Input
                id="r-participants"
                type="number"
                inputMode="numeric"
                min={1}
                value={v.expectedParticipants}
                onChange={set('expectedParticipants')}
              />
            </Field>
          </div>
        </Card>
        <ScheduleCard values={v} errors={errors} set={set} />
        <Card>
          <CardTitle>{t('competitions.venue')}</CardTitle>
          {v.organizationId ? (
            <VenueSelect
              organizationId={v.organizationId}
              value={v.venueId}
              timezone={v.timezone}
              error={tf(errors.venueId)}
              onChange={(venueId) => setV((x) => ({ ...x, venueId }))}
            />
          ) : null}
        </Card>
        <RecruitmentDraftCard value={recruitment} onChange={setRecruitment} errors={errors} />
        <Card>
          <CardTitle>{t('competitionRequests.details')}</CardTitle>
          <div className="grid gap-4">
            <Field
              id="r-description"
              label={t('competitionRequests.description')}
              error={tf(errors.descriptionMd)}
            >
              <Textarea
                id="r-description"
                value={v.descriptionMd}
                onChange={set('descriptionMd')}
                maxLength={20000}
                rows={4}
              />
            </Field>
            <Field
              id="r-comment"
              label={t('competitionRequests.comment')}
              hint={t('competitionRequests.commentHint')}
              error={tf(errors.comment)}
            >
              <Textarea
                id="r-comment"
                value={v.comment}
                onChange={set('comment')}
                maxLength={2000}
                rows={3}
              />
            </Field>
          </div>
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={action.busy} disabled={!v.organizationId}>
            {t('competitionRequests.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/competition-requests')}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </>
  );
}
