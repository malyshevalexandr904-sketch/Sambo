'use client';
// Поля человека (спортсмен, представитель, тренер, судья). Проверка — на сервере; ошибки полей по пути.
import { GENDERS } from '@sde/contracts';
import { Field, Input, Select } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';

export interface PersonValues {
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  gender: 'MALE' | 'FEMALE';
}

export const emptyPerson = (): PersonValues => ({
  lastName: '',
  firstName: '',
  middleName: '',
  birthDate: '',
  gender: 'MALE',
});

export function personPayload(v: PersonValues): Record<string, string> {
  const p: Record<string, string> = {
    lastName: v.lastName.trim(),
    firstName: v.firstName.trim(),
    birthDate: v.birthDate,
    gender: v.gender,
  };
  if (v.middleName.trim()) p.middleName = v.middleName.trim();
  return p;
}

/** Коды ошибок полей с сервера по префиксу пути: `person.lastName` → `lastName`. */
export function fieldErrors(error: unknown, prefix = ''): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const f of error.fields) if (f.path.startsWith(prefix)) out[f.path.slice(prefix.length)] = f.code;
  return out;
}

/** Подмножество ошибок по префиксу: `{ 'person.lastName': c }` → `{ lastName: c }`. */
export function withPrefix(errors: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

export function PersonFields({
  idPrefix,
  value,
  onChange,
  errors = {},
}: {
  idPrefix: string;
  value: PersonValues;
  onChange: (v: PersonValues) => void;
  errors?: Record<string, string>;
}) {
  const t = useTranslations('people');
  const tf = useFieldMessage();
  const set = (k: keyof PersonValues) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  const id = (k: string): string => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field id={id('lastName')} label={t('lastName')} error={tf(errors.lastName)}>
        <Input
          id={id('lastName')}
          required
          value={value.lastName}
          onChange={set('lastName')}
          aria-invalid={!!errors.lastName}
          autoComplete="off"
        />
      </Field>
      <Field id={id('firstName')} label={t('firstName')} error={tf(errors.firstName)}>
        <Input
          id={id('firstName')}
          required
          value={value.firstName}
          onChange={set('firstName')}
          aria-invalid={!!errors.firstName}
          autoComplete="off"
        />
      </Field>
      <Field id={id('middleName')} label={t('middleName')} error={tf(errors.middleName)}>
        <Input
          id={id('middleName')}
          value={value.middleName}
          onChange={set('middleName')}
          autoComplete="off"
        />
      </Field>
      <Field id={id('birthDate')} label={t('birthDate')} error={tf(errors.birthDate)}>
        <Input
          id={id('birthDate')}
          type="date"
          required
          value={value.birthDate}
          onChange={set('birthDate')}
          aria-invalid={!!errors.birthDate}
        />
      </Field>
      <Field id={id('gender')} label={t('gender')} error={tf(errors.gender)}>
        <Select id={id('gender')} value={value.gender} onChange={set('gender')}>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {t(`genders.${g}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
