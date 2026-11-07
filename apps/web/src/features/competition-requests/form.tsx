'use client';
// Заявка организации на проведение турнира (описание процесса, 02.11.2026): название, день, адрес, до двух шаблонных
// возрастных групп, ковры, материально-техническая база и судейская бригада (с расчётом минимума), пол участников,
// ответственный за проведение и согласие с правилами подачи. Сроки регистрации и взвешивания уточняет платформа.
// Черновик (правки 05.11.2026): форму можно сохранить как есть и вернуться к ней из «Турниры → Ваши черновики»;
// черновик видит только организация, данные проверяются при подаче.
import {
  type AgeGroupDto,
  type CompetitionRequestCreate,
  type CompetitionRequestDto,
  type DataEnvelope,
  HOSTING_AVAILABILITY,
  HOSTING_CONTACT_CHANNELS,
  HOSTING_GENDERS,
  HOSTING_MAX_AGE_GROUPS,
  HOSTING_MAX_MATS,
  type HostingAvailability,
  type HostingContactChannel,
  type HostingGender,
  type ResponsibleCandidateDto,
  hostingRequirements,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, cn, Field, Input, PageHeader, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { QueryState } from '@/components/common';
import { OrganizationPicker } from '@/components/organization-picker';
import { today } from '@/features/competitions/create';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { Choice, EquipmentList, RADIO, RefereeList, radioTone } from './form-parts';
import { HostingProcessButton, HostingRulesLink } from './hosting-info';
import { ResponsibleUserSearch } from './user-search';

type ResponsibleKind = 'SELF' | 'USER' | 'CONTACT';

interface FormValues {
  organizationId: string;
  name: string;
  date: string;
  address: string;
  ageGroupIds: string[];
  matCount: string;
  equipment: HostingAvailability | '';
  refereeTeam: HostingAvailability | '';
  gender: HostingGender | '';
  responsible: ResponsibleKind;
  responsibleUser: ResponsibleCandidateDto | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** Способ связи администратора платформы с организатором (правки 07.11.2026, п. 11). */
  contactChannel: HostingContactChannel | '';
  contactValue: string;
  comment: string;
  rulesAccepted: boolean;
}

/** «8 (999) 123-45-67» → «+79991234567»; остальное проверит сервер. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

const EMPTY: FormValues = {
  organizationId: '',
  name: '',
  date: '',
  address: '',
  ageGroupIds: [],
  matCount: '',
  equipment: '',
  refereeTeam: '',
  gender: '',
  responsible: 'SELF',
  responsibleUser: null,
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  contactChannel: '',
  contactValue: '',
  comment: '',
  rulesAccepted: false,
};

/** Данные черновика → значения формы: берём только известные поля нужного типа (согласие — всегда заново). */
function fromDraft(data: Record<string, unknown>): Partial<FormValues> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(EMPTY)) {
    if (k === 'rulesAccepted' || !(k in data)) continue;
    const value = data[k];
    if (k === 'responsibleUser') out[k] = value && typeof value === 'object' ? value : null;
    else if (Array.isArray(def))
      out[k] = Array.isArray(value) ? value.filter((x) => typeof x === 'string') : def;
    else if (typeof value === typeof def) out[k] = value;
  }
  return out;
}

function useTemplateAgeGroups() {
  const params = { owner: 'platform', disciplineCode: 'SPORT_SAMBO' };
  return useQuery({
    queryKey: qk.ageGroups(params),
    queryFn: async () => (await api<DataEnvelope<AgeGroupDto[]>>('/age-groups', { query: params })).data,
  });
}

export function CompetitionRequestForm() {
  const t = useTranslations();
  const tr = useTranslations('competitionRequests');
  const locale = useLocale();
  const router = useRouter();
  const tf = useFieldMessage();
  const action = useAction();
  const queryClient = useQueryClient();
  const groups = useTemplateAgeGroups();
  const [v, setV] = useState<FormValues>(EMPTY);
  const search = useSearchParams();
  const [draftId, setDraftId] = useState<string | null>(search.get('draft'));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const draft = useQuery({
    queryKey: ['competition-requests', 'draft', draftId],
    queryFn: async () =>
      (await api<DataEnvelope<CompetitionRequestDto>>(`/competition-requests/${draftId}`)).data,
    enabled: !!draftId,
    staleTime: Infinity,
  });
  const draftGone = !!draft.data && draft.data.status !== 'DRAFT';
  const activeDraft = draftId && !draftGone ? draftId : null;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !draft.data) return;
    setLoaded(true);
    if (draft.data.status !== 'DRAFT') return;
    setV((x) => ({ ...x, ...fromDraft(draft.data.draft ?? {}), organizationId: draft.data.organization.id }));
  }, [draft.data, loaded]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setOrganization = useCallback((id: string) => setV((x) => ({ ...x, organizationId: id })), []);
  /** Исправленное поле больше не подсвечивается ошибкой. */
  const ERROR_KEYS: Partial<Record<keyof FormValues, string[]>> = {
    date: ['startDate'],
    responsibleUser: ['responsible.userId'],
    contactName: ['responsible.fullName'],
    contactPhone: ['responsible.phone'],
    contactEmail: ['responsible.phone', 'responsible.email'],
    responsible: ['responsible.userId', 'responsible.email', 'responsible.fullName', 'responsible.phone'],
    contactChannel: ['contact.channel', 'contact.value'],
    contactValue: ['contact.value'],
  };
  const clearErrors = (keys: (keyof FormValues)[]): void =>
    setErrors((e) => {
      const drop = keys.flatMap((k) => ERROR_KEYS[k] ?? [k]);
      if (!drop.some((k) => k in e)) return e;
      return Object.fromEntries(Object.entries(e).filter(([k]) => !drop.includes(k)));
    });
  const set =
    (k: keyof FormValues) =>
    (e: { target: { value: string } }): void => {
      setV((x) => ({ ...x, [k]: e.target.value }));
      clearErrors([k]);
    };
  const patch = (p: Partial<FormValues>): void => {
    setV((x) => ({ ...x, ...p }));
    clearErrors(Object.keys(p) as (keyof FormValues)[]);
  };

  const mats = Number(v.matCount);
  const matsValid = Number.isInteger(mats) && mats >= 1 && mats <= HOSTING_MAX_MATS;
  const req = matsValid ? hostingRequirements(mats, v.ageGroupIds.length) : null;

  const toggleGroup = (id: string): void => {
    clearErrors(['ageGroupIds']);
    setV((x) => ({
      ...x,
      ageGroupIds: x.ageGroupIds.includes(id)
        ? x.ageGroupIds.filter((g) => g !== id)
        : x.ageGroupIds.length < HOSTING_MAX_AGE_GROUPS
          ? [...x.ageGroupIds, id]
          : x.ageGroupIds,
    }));
  };

  const responsibleBody = (): CompetitionRequestCreate['responsible'] => {
    if (v.responsible === 'USER' && v.responsibleUser) return { kind: 'USER', userId: v.responsibleUser.id };
    if (v.responsible === 'CONTACT')
      return {
        kind: 'CONTACT',
        fullName: v.contactName.trim(),
        ...(v.contactPhone.trim() ? { phone: normalizePhone(v.contactPhone) } : {}),
        ...(v.contactEmail.trim() ? { email: v.contactEmail.trim() } : {}),
      };
    return { kind: 'SELF' };
  };

  /** Сохранить черновик как есть: без проверок, их сделает подача. */
  const saveDraft = (): void => {
    const { rulesAccepted: _skip, ...data } = v;
    const body = {
      organizationId: v.organizationId,
      name: v.name.trim() || undefined,
      data: { ...data, startDate: v.date || undefined },
    };
    void action.run(async () => {
      const res = await api<DataEnvelope<CompetitionRequestDto>>(
        activeDraft ? `/competition-requests/${activeDraft}/draft` : '/competition-requests/drafts',
        { method: activeDraft ? 'PUT' : 'POST', body },
      );
      if (!activeDraft) {
        setDraftId(res.data.id);
        setLoaded(true);
        window.history.replaceState(null, '', `${window.location.pathname}?draft=${res.data.id}`);
      }
      setSavedAt(new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date()));
      await queryClient.invalidateQueries({ queryKey: ['competition-requests'] });
    });
  };

  const submit = (): void => {
    const local: Record<string, string> = {};
    if (v.name.trim().length < 3) local.name = 'too_short';
    if (!v.date) local.startDate = 'required';
    if (v.address.trim().length < 5) local.address = v.address.trim() ? 'too_short' : 'required';
    if (v.ageGroupIds.length === 0 && (groups.data ?? []).length > 0) local.ageGroupIds = 'required';
    if (!matsValid) local.matCount = 'required';
    if (!v.equipment) local.equipment = 'required';
    if (!v.refereeTeam) local.refereeTeam = 'required';
    if (!v.gender) local.gender = 'required';
    if (v.responsible === 'USER' && !v.responsibleUser)
      local['responsible.userId'] = 'responsible_not_chosen';
    if (v.responsible === 'CONTACT') {
      if (v.contactName.trim().length < 3) local['responsible.fullName'] = 'required';
      if (!v.contactPhone.trim() && !v.contactEmail.trim()) local['responsible.phone'] = 'contact_required';
    }
    if (!v.contactChannel) local['contact.channel'] = 'required';
    else if (v.contactValue.trim().length < 3) local['contact.value'] = 'required';
    if (!v.rulesAccepted) local.rulesAccepted = 'consent_required';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    const body = {
      organizationId: v.organizationId,
      name: v.name.trim(),
      startDate: v.date,
      address: v.address.trim(),
      ageGroupIds: v.ageGroupIds,
      matCount: mats,
      equipment: v.equipment,
      refereeTeam: v.refereeTeam,
      gender: v.gender,
      responsible: responsibleBody(),
      contact: { channel: v.contactChannel, value: v.contactValue.trim() },
      rulesAccepted: true,
      comment: v.comment.trim() || undefined,
      ...(activeDraft ? { draftId: activeDraft } : {}),
    } as CompetitionRequestCreate;
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

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <>
      <PageHeader title={tr('newTitle')} description={tr('newHint')} actions={<HostingProcessButton />} />
      <form
        noValidate
        className="grid max-w-3xl gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {draftId ? <Alert tone="info">{draftGone ? tr('draftGone') : tr('draftEditing')}</Alert> : null}
        <Card>
          <CardTitle>{t('competitions.sectionMain')}</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <OrganizationPicker
              id="r-org"
              label={tr('organization')}
              permission="competition.request"
              value={v.organizationId}
              onChange={setOrganization}
              className="sm:col-span-2"
            />
            <Field
              id="r-name"
              label={tr('fullName')}
              hint={tr('fullNameHint')}
              error={tf(errors.name)}
              className="sm:col-span-2"
            >
              <Input id="r-name" value={v.name} onChange={set('name')} maxLength={200} required />
            </Field>
            <Field id="r-date" label={tr('date')} hint={tr('dateHint')} error={tf(errors.startDate)}>
              <Input id="r-date" type="date" min={today()} value={v.date} onChange={set('date')} required />
            </Field>
            <Field id="r-mats" label={tr('matCount')} hint={tr('matCountHint')} error={tf(errors.matCount)}>
              <Input
                id="r-mats"
                type="number"
                inputMode="numeric"
                min={1}
                max={HOSTING_MAX_MATS}
                value={v.matCount}
                onChange={set('matCount')}
                required
              />
            </Field>
            <Field
              id="r-address"
              label={tr('address')}
              hint={tr('addressHint')}
              error={tf(errors.address)}
              className="sm:col-span-2"
            >
              <Textarea
                id="r-address"
                value={v.address}
                onChange={set('address')}
                maxLength={500}
                rows={2}
                required
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>{tr('participants')}</CardTitle>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">{tr('ageGroups')}</legend>
            <p className="mt-1 text-xs text-slate-500">
              {tr('ageGroupsHint', { max: HOSTING_MAX_AGE_GROUPS })}
            </p>
            <QueryState isPending={groups.isPending} error={groups.error}>
              {() =>
                (groups.data ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">{tr('ageGroupsEmpty')}</p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(groups.data ?? []).map((g) => {
                      const on = v.ageGroupIds.includes(g.id);
                      const full = !on && v.ageGroupIds.length >= HOSTING_MAX_AGE_GROUPS;
                      return (
                        <label
                          key={g.id}
                          className={cn(RADIO, radioTone(on), full && 'cursor-not-allowed opacity-50')}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={full}
                            onChange={() => toggleGroup(g.id)}
                            className="h-4 w-4 accent-blue-700"
                          />
                          <span className="flex-1">{pickName(g.name, locale)}</span>
                          <span className="text-xs tabular-nums text-slate-500">
                            {tr('ages', { from: g.ageFrom, to: g.ageTo })}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )
              }
            </QueryState>
            {errors.ageGroupIds ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {tf(errors.ageGroupIds)}
              </p>
            ) : null}
          </fieldset>
          <div className="mt-5">
            <Choice
              name="r-gender"
              legend={tr('gender')}
              options={HOSTING_GENDERS}
              value={v.gender}
              onChange={(gender) => patch({ gender })}
              label={(g) => tr(`genders.${g}`)}
              error={tf(errors.gender)}
              columns={2}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>{tr('equipment')}</CardTitle>
          <Choice
            name="r-equipment"
            legend={tr('equipmentQuestion')}
            options={HOSTING_AVAILABILITY}
            value={v.equipment}
            onChange={(equipment) => patch({ equipment })}
            label={(a) => tr(`availability.${a}`)}
            error={tf(errors.equipment)}
          />
          {req ? (
            <EquipmentList req={req} mats={mats} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">{tr('needMats')}</p>
          )}
        </Card>

        <Card>
          <CardTitle>{tr('refereeTeam')}</CardTitle>
          <Choice
            name="r-referees"
            legend={tr('refereeTeamQuestion')}
            options={HOSTING_AVAILABILITY}
            value={v.refereeTeam}
            onChange={(refereeTeam) => patch({ refereeTeam })}
            label={(a) => tr(`availability.${a}`)}
            error={tf(errors.refereeTeam)}
          />
          {req ? (
            <RefereeList req={req} mats={mats} groups={v.ageGroupIds.length} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">{tr('needMats')}</p>
          )}
        </Card>

        <Card>
          <CardTitle>{tr('responsible')}</CardTitle>
          <p className="mb-3 text-sm text-slate-600">{tr('responsibleHint')}</p>
          <Choice
            name="r-responsible"
            legend={tr('responsibleQuestion')}
            options={['SELF', 'USER', 'CONTACT'] as const}
            value={v.responsible}
            onChange={(responsible) => patch({ responsible })}
            label={(k) => tr(`responsibleKinds.${k}`)}
          />
          {v.responsible === 'USER' ? (
            <ResponsibleUserSearch
              value={v.responsibleUser}
              onChange={(responsibleUser) => patch({ responsibleUser })}
              error={tf(errors['responsible.userId'])}
            />
          ) : null}
          {v.responsible === 'CONTACT' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                id="r-contact-name"
                label={tr('contactName')}
                error={tf(errors['responsible.fullName'])}
                className="sm:col-span-2"
              >
                <Input
                  id="r-contact-name"
                  autoComplete="name"
                  value={v.contactName}
                  onChange={set('contactName')}
                  maxLength={200}
                />
              </Field>
              <Field
                id="r-contact-phone"
                label={tr('contactPhone')}
                hint={tr('contactPhoneHint')}
                error={tf(errors['responsible.phone'])}
              >
                <Input
                  id="r-contact-phone"
                  type="tel"
                  autoComplete="tel"
                  value={v.contactPhone}
                  onChange={set('contactPhone')}
                />
              </Field>
              <Field id="r-contact-email" label={t('auth.email')} error={tf(errors['responsible.email'])}>
                <Input
                  id="r-contact-email"
                  type="email"
                  autoComplete="email"
                  value={v.contactEmail}
                  onChange={set('contactEmail')}
                />
              </Field>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{tr('contactMethod')}</CardTitle>
          <p className="mb-3 text-sm text-slate-600">{tr('contactMethodHint')}</p>
          <Choice
            name="r-contact-channel"
            legend={tr('contactMethodQuestion')}
            options={HOSTING_CONTACT_CHANNELS}
            value={v.contactChannel}
            onChange={(contactChannel) => patch({ contactChannel })}
            label={(k) => tr(`contactChannels.${k}`)}
            error={tf(errors['contact.channel'])}
          />
          {v.contactChannel ? (
            <Field
              id="r-contact-value"
              label={tr(`contactValue.${v.contactChannel}`)}
              hint={tr(`contactValueHint.${v.contactChannel}`)}
              error={tf(errors['contact.value'])}
              className="mt-4"
            >
              <Input
                id="r-contact-value"
                type={v.contactChannel === 'EMAIL' ? 'email' : 'text'}
                autoComplete={v.contactChannel === 'EMAIL' ? 'email' : 'off'}
                value={v.contactValue}
                onChange={set('contactValue')}
                maxLength={200}
              />
            </Field>
          ) : null}
        </Card>

        <Card>
          <Field id="r-comment" label={tr('comment')} hint={tr('commentHint')} error={tf(errors.comment)}>
            <Textarea id="r-comment" value={v.comment} onChange={set('comment')} maxLength={2000} rows={3} />
          </Field>
        </Card>

        <div>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-blue-700"
              checked={v.rulesAccepted}
              aria-invalid={!!errors.rulesAccepted}
              onChange={(e) => patch({ rulesAccepted: e.target.checked })}
            />
            <span>
              {tr.rich('rulesConsent', {
                rules: (chunks) => <HostingRulesLink>{chunks}</HostingRulesLink>,
              })}
            </span>
          </label>
          {errors.rulesAccepted ? (
            <p role="alert" className="text-sm text-red-700">
              {tf(errors.rulesAccepted)}
            </p>
          ) : null}
        </div>
        {hasErrors ? <Alert tone="danger">{tr('fixErrors')}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={action.busy} disabled={!v.organizationId}>
            {tr('submit')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={action.busy}
            disabled={!v.organizationId}
            onClick={saveDraft}
          >
            {tr('saveDraft')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/competitions')}>
            {t('common.cancel')}
          </Button>
        </div>
        {savedAt ? (
          <p role="status" className="-mt-3 text-sm text-green-800">
            {tr('draftSaved', { time: savedAt })}
          </p>
        ) : (
          <p className="-mt-3 text-sm text-slate-600">{tr('draftHint')}</p>
        )}
      </form>
    </>
  );
}
