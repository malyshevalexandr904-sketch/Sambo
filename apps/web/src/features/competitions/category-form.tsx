'use client';
// Добавление категории турнира вручную (API.md, 5.2): код, названия, пол, возраст и весовые границы.
// Правила кода, диапазонов и пересечений проверяет сервер (VALIDATION_FAILED с полями).
import { AGE_POLICIES, type CategoryInput, type Competition, GENDERS } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { useInvalidateCompetition } from './shared';

export function AddCategoryCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions.categories');
  const tp = useTranslations('catalog.policies');
  const tg = useTranslations('people.genders');
  const invalidate = useInvalidateCompetition(c.id);
  const queryClient = useQueryClient();
  const action = useAction();
  const [v, setV] = useState({
    code: '',
    nameRu: '',
    nameEn: '',
    gender: 'MALE',
    policy: 'BY_BIRTH_YEAR',
    from: '',
    to: '',
    weightKind: 'UP_TO',
    lower: '',
    upper: '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const kgToGrams = (kg: string): number | undefined =>
    kg ? Math.round(Number(kg.replace(',', '.')) * 1000) : undefined;
  const byYears = v.policy === 'BIRTH_YEAR_RANGE';
  return (
    <Card>
      <CardTitle>{t('addTitle')}</CardTitle>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body: CategoryInput = {
            code: v.code.trim().toUpperCase(),
            name: { ru: v.nameRu.trim(), en: (v.nameEn || v.nameRu).trim() },
            gender: v.gender as CategoryInput['gender'],
            age: byYears
              ? {
                  policy: 'BIRTH_YEAR_RANGE',
                  birthYearFrom: Number(v.from) || null,
                  birthYearTo: Number(v.to) || null,
                }
              : {
                  policy: v.policy as CategoryInput['age']['policy'],
                  ageFrom: Number(v.from) || null,
                  ageTo: Number(v.to) || null,
                },
            weight: {
              kind: v.weightKind as 'UP_TO' | 'ABOVE',
              lowerGrams: kgToGrams(v.lower) ?? null,
              upperGrams: v.weightKind === 'ABOVE' ? null : (kgToGrams(v.upper) ?? null),
            },
          };
          void action.run(async () => {
            await api(`/competitions/${c.id}/categories`, { method: 'POST', body });
            await invalidate();
            await queryClient.invalidateQueries({ queryKey: qk.competitionCategories(c.id) });
            setV((x) => ({ ...x, code: '', nameRu: '', nameEn: '', lower: '', upper: '' }));
          });
        }}
      >
        <Field id="cat-code" label={t('code')} hint={t('codeHint')}>
          <Input id="cat-code" value={v.code} onChange={set('code')} maxLength={40} />
        </Field>
        <Field id="cat-name-ru" label={t('nameRu')}>
          <Input id="cat-name-ru" value={v.nameRu} onChange={set('nameRu')} maxLength={120} />
        </Field>
        <Field id="cat-name-en" label={t('nameEn')}>
          <Input id="cat-name-en" value={v.nameEn} onChange={set('nameEn')} maxLength={120} />
        </Field>
        <Field id="cat-gender" label={t('gender')}>
          <Select id="cat-gender" value={v.gender} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {tg(g)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cat-policy" label={t('agePolicy')}>
          <Select id="cat-policy" value={v.policy} onChange={set('policy')}>
            {AGE_POLICIES.map((p) => (
              <option key={p} value={p}>
                {tp(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cat-from" label={byYears ? t('birthYearFrom') : t('ageFrom')}>
          <Input id="cat-from" type="number" value={v.from} onChange={set('from')} />
        </Field>
        <Field id="cat-to" label={byYears ? t('birthYearTo') : t('ageTo')}>
          <Input id="cat-to" type="number" value={v.to} onChange={set('to')} />
        </Field>
        <Field id="cat-wkind" label={t('weightKind')}>
          <Select id="cat-wkind" value={v.weightKind} onChange={set('weightKind')}>
            <option value="UP_TO">{t('upTo')}</option>
            <option value="ABOVE">{t('above')}</option>
          </Select>
        </Field>
        <Field
          id="cat-lower"
          label={t('lowerKg')}
          hint={v.weightKind === 'UP_TO' ? t('lowerHint') : undefined}
        >
          <Input id="cat-lower" inputMode="decimal" value={v.lower} onChange={set('lower')} />
        </Field>
        {v.weightKind === 'UP_TO' ? (
          <Field id="cat-upper" label={t('upperKg')}>
            <Input id="cat-upper" inputMode="decimal" value={v.upper} onChange={set('upper')} />
          </Field>
        ) : null}
        <div className="flex items-end">
          <Button type="submit" loading={action.busy} disabled={v.code.trim().length < 2 || !v.nameRu.trim()}>
            {t('add')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
