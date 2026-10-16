'use client';
// Шаги мастера заявки (Phase 9a): вопросы сценария, личные данные, способы связи. Поля, не относящиеся к роли и
// ответам, не показываются; ошибки — рядом с полем (коды с сервера и общей проверки полноты).
import {
  CONTACT_CHANNELS,
  GENDERS,
  ONBOARDING_ORGANIZATION_TYPES,
  type OnboardingRequestDto,
  ORGANIZATION_LEGAL_FORMS,
} from '@sde/contracts';
import { Alert, Button, Field, Input, Select } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { pickName, useCountries, useRefereeCategories, useRegions } from '@/lib/queries';
import type { OnboardingForm } from './form';
import { useCoachOptions, useOnboardingFieldMessage, useOrganizationOptions } from './shared';

export interface StepProps {
  request: OnboardingRequestDto;
  form: OnboardingForm;
  setForm: (f: OnboardingForm) => void;
  errors: Record<string, string>;
}

function YesNo({
  id,
  legend,
  value,
  onChange,
  error,
}: {
  id: string;
  legend: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  const tc = useTranslations('common');
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium text-slate-800">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {([true, false] as const).map((v) => (
          <label
            key={String(v)}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
          >
            <input
              type="radio"
              name={id}
              className="h-5 w-5"
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {v ? tc('yes') : tc('no')}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Шаг 2 — вопросы, определяющие сценарий: организация и тренер, тип и статус организации, категория судьи. */
export function ScenarioStep({ request: r, form, setForm, errors }: StepProps) {
  const t = useTranslations('onboarding');
  const fm = useOnboardingFieldMessage();
  const locale = useLocale();
  const categories = useRefereeCategories();
  const join = r.kind === 'JOIN_ORGANIZATION';
  const withOrg = r.role === 'COACH' || r.role === 'ATHLETE';
  return (
    <div className="space-y-5">
      {withOrg && !join ? (
        <YesNo
          id="inOrganization"
          legend={t('fields.inOrganization')}
          value={form.inOrganization}
          error={fm(errors.inOrganization)}
          onChange={(v) =>
            setForm({ ...form, inOrganization: v, organizationId: v ? form.organizationId : '', coachId: '' })
          }
        />
      ) : null}
      {withOrg && (join || form.inOrganization) ? (
        <OrganizationPicker
          form={form}
          setForm={setForm}
          errors={errors}
          onNone={
            join
              ? undefined
              : () => setForm({ ...form, inOrganization: false, organizationId: '', coachId: '' })
          }
        />
      ) : null}
      {r.role === 'ATHLETE' && form.organizationId ? (
        <CoachPicker
          form={form}
          setForm={setForm}
          errors={errors}
          onNone={
            join
              ? undefined
              : () => setForm({ ...form, inOrganization: false, organizationId: '', coachId: '' })
          }
        />
      ) : null}
      {withOrg && form.inOrganization === false && !join ? (
        <Alert tone="info">{t(`hints.independent.${r.role}`)}</Alert>
      ) : null}
      {r.role === 'REFEREE' ? (
        <Field
          id="refereeCategoryCode"
          label={t('fields.refereeCategory')}
          hint={t('hints.refereeCategory')}
          error={fm(errors.refereeCategoryCode)}
        >
          <Select
            id="refereeCategoryCode"
            value={form.refereeCategoryCode}
            aria-invalid={!!errors.refereeCategoryCode}
            onChange={(e) => setForm({ ...form, refereeCategoryCode: e.target.value })}
          >
            <option value="">{t('fields.choose')}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {pickName(c.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {r.role === 'ORGANIZATION_HEAD' ? (
        <>
          <Field id="org-type" label={t('fields.orgType')} error={fm(errors['organization.type'])}>
            <Select
              id="org-type"
              value={form.org.type}
              aria-invalid={!!errors['organization.type']}
              onChange={(e) => setForm({ ...form, org: { ...form.org, type: e.target.value } })}
            >
              <option value="">{t('fields.choose')}</option>
              {ONBOARDING_ORGANIZATION_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`orgTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="org-legalForm"
            label={t('fields.legalForm')}
            hint={t('hints.legalForm')}
            error={fm(errors['organization.legalForm'])}
          >
            <Select
              id="org-legalForm"
              value={form.org.legalForm}
              aria-invalid={!!errors['organization.legalForm']}
              onChange={(e) =>
                setForm({
                  ...form,
                  org: {
                    ...form.org,
                    legalForm: e.target.value,
                    countryCode: e.target.value === 'RU_LEGAL_ENTITY' ? 'RU' : form.org.countryCode,
                  },
                })
              }
            >
              <option value="">{t('fields.choose')}</option>
              {ORGANIZATION_LEGAL_FORMS.map((x) => (
                <option key={x} value={x}>
                  {t(`legalForms.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}
    </div>
  );
}

function OrganizationPicker({
  form,
  setForm,
  errors,
  onNone,
}: Omit<StepProps, 'request'> & { onNone?: () => void }) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const fm = useOnboardingFieldMessage();
  const [q, setQ] = useState('');
  const options = useOrganizationOptions(q, true);
  const list = options.data ?? [];
  return (
    <div className="space-y-2">
      <Field id="org-search" label={t('fields.organization')} hint={t('hints.organization')}>
        <Input
          id="org-search"
          type="search"
          value={q}
          placeholder={tc('searchOrganization')}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <Field id="organizationId" label={t('fields.organizationSelect')} error={fm(errors.organizationId)}>
        <Select
          id="organizationId"
          value={form.organizationId}
          aria-invalid={!!errors.organizationId}
          onChange={(e) => setForm({ ...form, organizationId: e.target.value, coachId: '' })}
        >
          <option value="">{options.isPending ? tc('loading') : t('fields.choose')}</option>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.city ? ` — ${o.city}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      {!options.isPending && list.length === 0 ? (
        <Alert tone="warning" title={t('empty.organizations')}>
          {t('empty.organizationsHint')}
          {onNone ? (
            <Button variant="secondary" size="sm" className="mt-2" onClick={onNone}>
              {t('empty.continueIndependent')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}

function CoachPicker({
  form,
  setForm,
  errors,
  onNone,
}: Omit<StepProps, 'request'> & { onNone?: () => void }) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const fm = useOnboardingFieldMessage();
  const coaches = useCoachOptions(form.organizationId || null);
  const list = coaches.data ?? [];
  return (
    <div className="space-y-2">
      <Field id="coachId" label={t('fields.coach')} hint={t('hints.coach')} error={fm(errors.coachId)}>
        <Select
          id="coachId"
          value={form.coachId}
          aria-invalid={!!errors.coachId}
          onChange={(e) => setForm({ ...form, coachId: e.target.value })}
        >
          <option value="">{coaches.isPending ? tc('loading') : t('fields.choose')}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.publicName}
            </option>
          ))}
        </Select>
      </Field>
      {!coaches.isPending && list.length === 0 ? (
        <Alert tone="warning" title={t('empty.coaches')}>
          {t('empty.coachesHint')}
          {onNone ? (
            <Button variant="secondary" size="sm" className="mt-2" onClick={onNone}>
              {t('empty.continueIndependent')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Шаг 3 — личные данные (и данные организации руководителя). */
export function PersonalStep({ request: r, form, setForm, errors }: StepProps) {
  const t = useTranslations('onboarding');
  const tp = useTranslations('people');
  const fm = useOnboardingFieldMessage();
  const set = (k: keyof Omit<OnboardingForm, 'org' | 'contactChannels' | 'inOrganization'>) => (v: string) =>
    setForm({ ...form, [k]: v });
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="lastName"
          label={tp('lastName')}
          value={form.lastName}
          onChange={set('lastName')}
          error={fm(errors.lastName)}
          autoComplete="family-name"
          required
        />
        <TextField
          id="firstName"
          label={tp('firstName')}
          value={form.firstName}
          onChange={set('firstName')}
          error={fm(errors.firstName)}
          autoComplete="given-name"
          required
        />
        <TextField
          id="middleName"
          label={t('fields.middleName')}
          value={form.middleName}
          onChange={set('middleName')}
          error={fm(errors.middleName)}
          autoComplete="additional-name"
        />
        <TextField
          id="birthDate"
          label={tp('birthDate')}
          type="date"
          value={form.birthDate}
          onChange={set('birthDate')}
          error={fm(errors.birthDate)}
          autoComplete="bday"
          required
        />
        <Field id="gender" label={tp('gender')} error={fm(errors.gender)}>
          <Select
            id="gender"
            value={form.gender}
            aria-invalid={!!errors.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
          >
            <option value="">{t('fields.choose')}</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {tp(`genders.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
        <TextField
          id="phone"
          label={t('fields.phone')}
          type="tel"
          hint={t('hints.phone')}
          value={form.phone}
          onChange={set('phone')}
          error={fm(errors.phone)}
          autoComplete="tel"
          required
        />
        <TextField
          id="contactEmail"
          label={t('fields.email')}
          type="email"
          value={form.contactEmail}
          onChange={set('contactEmail')}
          error={fm(errors.contactEmail)}
          autoComplete="email"
          required
        />
        {r.role === 'COACH' ? (
          <TextField
            id="coachQualification"
            label={t('fields.coachQualification')}
            hint={t('hints.coachQualification')}
            value={form.coachQualification}
            onChange={set('coachQualification')}
            error={fm(errors.coachQualification)}
          />
        ) : null}
      </div>
      {r.role === 'ORGANIZATION_HEAD' ? (
        <OrganizationFields form={form} setForm={setForm} errors={errors} />
      ) : null}
    </div>
  );
}

function OrganizationFields({ form, setForm, errors }: Omit<StepProps, 'request'>) {
  const t = useTranslations('onboarding');
  const fm = useOnboardingFieldMessage();
  const locale = useLocale();
  const countries = useCountries();
  const regions = useRegions(form.org.countryCode);
  const o = form.org;
  const set = (k: keyof typeof o) => (v: string) => setForm({ ...form, org: { ...o, [k]: v } });
  const ru = o.legalForm === 'RU_LEGAL_ENTITY';
  const e = (k: string) => fm(errors[`organization.${k}`]);
  return (
    <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-800">{t('fields.organizationData')}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="org-name"
          label={t('fields.orgName')}
          value={o.name}
          onChange={set('name')}
          error={e('name')}
          required
        />
        <TextField
          id="org-shortName"
          label={t('fields.orgShortName')}
          value={o.shortName}
          onChange={set('shortName')}
          error={e('shortName')}
        />
        <Field id="org-country" label={t('fields.country')} error={e('countryCode')}>
          <Select
            id="org-country"
            value={o.countryCode}
            disabled={ru}
            onChange={(ev) => setForm({ ...form, org: { ...o, countryCode: ev.target.value, regionId: '' } })}
          >
            {(countries.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {pickName(c.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        {(regions.data ?? []).length > 0 ? (
          <Field id="org-region" label={t('fields.region')} error={e('regionId')}>
            <Select id="org-region" value={o.regionId} onChange={(ev) => set('regionId')(ev.target.value)}>
              <option value="">{t('fields.choose')}</option>
              {(regions.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {pickName(x.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <TextField
          id="org-city"
          label={t('fields.city')}
          value={o.city}
          onChange={set('city')}
          error={e('city')}
        />
      </div>
      {ru ? (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="org-inn"
            label={t('fields.inn')}
            value={o.inn}
            onChange={set('inn')}
            error={e('inn')}
            required
          />
          <TextField
            id="org-ogrn"
            label={t('fields.ogrn')}
            value={o.ogrn}
            onChange={set('ogrn')}
            error={e('ogrn')}
          />
          <TextField
            id="org-legalName"
            label={t('fields.legalName')}
            value={o.legalName}
            onChange={set('legalName')}
            error={e('legalName')}
            required
          />
          <TextField
            id="org-legalAddress"
            label={t('fields.legalAddress')}
            value={o.legalAddress}
            onChange={set('legalAddress')}
            error={e('legalAddress')}
            required
          />
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t('hints.foreignOrganization')}</p>
      )}
    </fieldset>
  );
}

/** Шаг 5 — предпочтительные способы связи (несколько). Автоматически пишем на email; телефон и Telegram — для связи. */
export function ContactsStep({ form, setForm, errors }: StepProps) {
  const t = useTranslations('onboarding');
  const fm = useOnboardingFieldMessage();
  const toggle = (c: (typeof CONTACT_CHANNELS)[number], on: boolean) =>
    setForm({
      ...form,
      contactChannels: on ? [...form.contactChannels, c] : form.contactChannels.filter((x) => x !== c),
    });
  return (
    <div className="space-y-4">
      <fieldset aria-describedby={errors.contactChannels ? 'contactChannels-error' : 'contactChannels-hint'}>
        <legend className="mb-2 text-sm font-medium text-slate-800">{t('fields.contactChannels')}</legend>
        <div className="flex flex-wrap gap-3">
          {CONTACT_CHANNELS.map((c) => (
            <label
              key={c}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
            >
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={form.contactChannels.includes(c)}
                onChange={(e) => toggle(c, e.target.checked)}
              />
              {t(`channels.${c}`)}
            </label>
          ))}
        </div>
        <p id="contactChannels-hint" className="mt-2 text-xs text-slate-500">
          {t('hints.channels')}
        </p>
        {errors.contactChannels ? (
          <p id="contactChannels-error" role="alert" className="mt-1 text-sm text-red-700">
            {fm(errors.contactChannels)}
          </p>
        ) : null}
      </fieldset>
      {form.contactChannels.includes('TELEGRAM') ? (
        <TextField
          id="telegram"
          label={t('fields.telegram')}
          hint={t('hints.telegram')}
          value={form.telegram}
          onChange={(v) => setForm({ ...form, telegram: v })}
          error={fm(errors.telegram)}
        />
      ) : null}
    </div>
  );
}
