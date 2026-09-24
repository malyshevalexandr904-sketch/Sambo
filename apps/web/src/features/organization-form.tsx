'use client';
// Форма организации: создание и редактирование. Проверка — на сервере (схема OrganizationInput),
// ошибки полей показываются на тех же полях (ARCHITECTURE.md, 23.1).
import { type Organization, ORGANIZATION_TYPES, type OrganizationSummary, type Page } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, ApiError } from '@/lib/api';
import { applyFieldErrors, useErrorMessage, useFieldMessage } from '@/lib/errors';
import { canCreateWithAuthority, qk, useCountries, useMe, useRegions } from '@/lib/queries';
import { LogoUpload } from './logo-upload';

export interface OrganizationFormValues {
  type: string;
  parentId: string;
  name: string;
  shortName: string;
  slug: string;
  countryCode: string;
  regionId: string;
  city: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  logoFileId: string;
  withLegal: boolean;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  managerEmail: string;
}

const FIELDS = [
  'type',
  'parentId',
  'name',
  'shortName',
  'slug',
  'countryCode',
  'regionId',
  'city',
  'address',
  'contactEmail',
  'contactPhone',
  'website',
  'logoFileId',
  'managerEmail',
] as const;
const LEGAL = ['legalName', 'inn', 'kpp', 'ogrn', 'legalAddress'] as const;

export function toFormValues(org?: Organization): OrganizationFormValues {
  return {
    type: org?.type ?? 'CLUB',
    parentId: org?.parentId ?? '',
    name: org?.name ?? '',
    shortName: org?.shortName ?? '',
    slug: org?.slug ?? '',
    countryCode: org?.countryCode ?? 'RU',
    regionId: org?.regionId ?? '',
    city: org?.city ?? '',
    address: org?.address ?? '',
    contactEmail: org?.contactEmail ?? '',
    contactPhone: org?.contactPhone ?? '',
    website: org?.website ?? '',
    logoFileId: org?.logoFileId ?? '',
    withLegal: Boolean(org?.legalDetails),
    legalName: org?.legalDetails?.legalName ?? '',
    inn: org?.legalDetails?.inn ?? '',
    kpp: org?.legalDetails?.kpp ?? '',
    ogrn: org?.legalDetails?.ogrn ?? '',
    legalAddress: org?.legalDetails?.legalAddress ?? '',
    managerEmail: '',
  };
}

/** Пустые строки → null: сервер различает «очистить поле» и «не менять». */
function toPayload(v: OrganizationFormValues, mode: 'create' | 'edit'): Record<string, unknown> {
  const opt = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  const payload: Record<string, unknown> = {
    type: v.type,
    parentId: opt(v.parentId),
    name: v.name.trim(),
    shortName: v.shortName.trim(),
    countryCode: v.countryCode,
    regionId: opt(v.regionId),
    city: opt(v.city),
    address: opt(v.address),
    contactEmail: opt(v.contactEmail),
    contactPhone: opt(v.contactPhone),
    website: opt(v.website),
    logoFileId: opt(v.logoFileId),
    legalDetails: v.withLegal
      ? {
          legalName: v.legalName.trim(),
          inn: v.inn.trim(),
          kpp: opt(v.kpp) ?? undefined,
          ogrn: opt(v.ogrn) ?? undefined,
          legalAddress: v.legalAddress.trim(),
        }
      : null,
  };
  if (v.slug.trim()) payload.slug = v.slug.trim();
  if (mode === 'create' && payload.parentId === null) delete payload.parentId;
  if (mode === 'create' && v.managerEmail.trim()) payload.managerEmail = v.managerEmail.trim();
  return payload;
}

export function OrganizationForm({
  initial,
  mode,
  onSubmit,
  submitLabel,
}: {
  initial?: Organization;
  mode: 'create' | 'edit';
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  submitLabel: string;
}) {
  const t = useTranslations('organizations');
  const tc = useTranslations();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<OrganizationFormValues>({ defaultValues: toFormValues(initial) });
  const countryCode = form.watch('countryCode');
  const withLegal = form.watch('withLegal');
  const me = useMe();
  // Создатель с полномочиями регистрирует организацию от имени руководителя и сам в неё не входит.
  const withManager = mode === 'create' && canCreateWithAuthority(me.data);
  const countries = useCountries();
  const regions = useRegions(countryCode);
  const parents = useQuery({
    queryKey: qk.organizations({ purpose: 'parents' }),
    queryFn: () =>
      api<Page<OrganizationSummary>>('/organizations', { query: { status: 'ACTIVE', limit: 100 } }),
  });
  const { errors, isSubmitting } = form.formState;
  const err = (name: keyof OrganizationFormValues): string | undefined => fieldMessage(errors[name]?.message);

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(toPayload(values, mode));
    } catch (e) {
      let mapped = applyFieldErrors(e, form.setError, [...FIELDS]);
      if (e instanceof ApiError) {
        for (const f of e.fields) {
          const key = f.path.replace('legalDetails.', '') as (typeof LEGAL)[number];
          if (f.path.startsWith('legalDetails.') && LEGAL.includes(key)) {
            form.setError(key, { type: 'server', message: f.code });
            mapped = true;
          }
        }
      }
      if (!mapped) setError(errorMessage(e));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardTitle>{t('details')}</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="type" label={t('type')} error={err('type')}>
            <Select id="type" {...form.register('type')}>
              {ORGANIZATION_TYPES.map((x) => (
                <option key={x} value={x}>
                  {tc(`orgTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="parentId" label={t('parent')} error={err('parentId')}>
            <Select id="parentId" {...form.register('parentId')}>
              <option value="">{t('noParent')}</option>
              {(parents.data?.data ?? [])
                .filter((p) => p.id !== initial?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.shortName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="name" label={t('name')} error={err('name')} className="md:col-span-2">
            <Input id="name" required aria-invalid={!!errors.name} {...form.register('name')} />
          </Field>
          <Field id="shortName" label={t('shortName')} error={err('shortName')}>
            <Input
              id="shortName"
              required
              aria-invalid={!!errors.shortName}
              {...form.register('shortName')}
            />
          </Field>
          <Field id="slug" label={t('slug')} hint={t('slugHint')} error={err('slug')}>
            <Input id="slug" aria-invalid={!!errors.slug} {...form.register('slug')} />
          </Field>
          <Field id="countryCode" label={t('country')} error={err('countryCode')}>
            <Select id="countryCode" {...form.register('countryCode')}>
              {(countries.data ?? [{ code: 'RU', name: { ru: 'Россия', en: 'Russia' } }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {locale === 'en' ? c.name.en : c.name.ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="regionId" label={t('region')} error={err('regionId')}>
            <Select id="regionId" {...form.register('regionId')}>
              <option value="">—</option>
              {(regions.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {locale === 'en' ? r.name.en : r.name.ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="city" label={t('city')} error={err('city')}>
            <Input id="city" {...form.register('city')} />
          </Field>
          <Field id="address" label={t('address')} error={err('address')}>
            <Input id="address" {...form.register('address')} />
          </Field>
          <Field id="contactEmail" label={t('contactEmail')} error={err('contactEmail')}>
            <Input id="contactEmail" type="email" {...form.register('contactEmail')} />
          </Field>
          <Field id="contactPhone" label={t('contactPhone')} error={err('contactPhone')}>
            <Input id="contactPhone" type="tel" {...form.register('contactPhone')} />
          </Field>
          <Field id="website" label={t('website')} error={err('website')} className="md:col-span-2">
            <Input id="website" type="url" {...form.register('website')} />
          </Field>
        </div>
      </Card>
      {withManager ? (
        <Card>
          <CardTitle>{t('manager')}</CardTitle>
          <Field
            id="managerEmail"
            label={t('managerEmail')}
            hint={t('managerEmailHint')}
            error={err('managerEmail')}
          >
            <Input id="managerEmail" type="email" autoComplete="off" {...form.register('managerEmail')} />
          </Field>
        </Card>
      ) : null}
      <Card>
        <CardTitle>{t('logo')}</CardTitle>
        <LogoUpload
          currentUrl={initial?.logoUrl ?? null}
          error={err('logoFileId')}
          onUploaded={(fileId) => form.setValue('logoFileId', fileId, { shouldDirty: true })}
        />
      </Card>
      <Card>
        <label className="mb-4 flex min-h-11 items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" {...form.register('withLegal')} />
          {t('legal')}
        </label>
        {withLegal ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="legalName" label={t('legalName')} error={err('legalName')} className="md:col-span-2">
              <Input id="legalName" {...form.register('legalName')} />
            </Field>
            <Field id="inn" label={t('inn')} error={err('inn')}>
              <Input id="inn" inputMode="numeric" {...form.register('inn')} />
            </Field>
            <Field id="kpp" label={t('kpp')} error={err('kpp')}>
              <Input id="kpp" inputMode="numeric" {...form.register('kpp')} />
            </Field>
            <Field id="ogrn" label={t('ogrn')} error={err('ogrn')}>
              <Input id="ogrn" inputMode="numeric" {...form.register('ogrn')} />
            </Field>
            <Field id="legalAddress" label={t('legalAddress')} error={err('legalAddress')}>
              <Input id="legalAddress" {...form.register('legalAddress')} />
            </Field>
          </div>
        ) : null}
      </Card>
      <Button type="submit" size="lg" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
