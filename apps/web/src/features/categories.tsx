'use client';
// Редактор категорий (API.md, 4.5): возрастные группы, весовые категории, шаблоны наборов категорий.
// Группы и веса — данные, а не код; турнир (Phase 4) копирует категории из шаблона.
import {
  AGE_POLICIES,
  type AgeGroupDto,
  type CategoryTemplateDto,
  type DataEnvelope,
  GENDERS,
  type Gender,
  WEIGHT_LIMIT_KINDS,
  weightLabelKg,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { QueryState } from '@/components/common';
import { fieldErrors } from '@/components/person-fields';
import { api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { invalidateCatalog, TemplatesPanel } from './category-templates';
import { OwnerAndDiscipline, ownerBody } from './owner-select';

export function CategoriesEditor() {
  const t = useTranslations();
  const [scope, setScope] = useState({ owner: '', discipline: 'SPORT_SAMBO' });
  const onScope = useCallback((v: { owner: string; discipline: string }) => setScope(v), []);
  const params = { owner: scope.owner, disciplineCode: scope.discipline };
  const groups = useQuery({
    queryKey: qk.ageGroups(params),
    queryFn: async () => (await api<DataEnvelope<AgeGroupDto[]>>('/age-groups', { query: params })).data,
    enabled: scope.owner !== '',
  });
  const templates = useQuery({
    queryKey: qk.categoryTemplates(params),
    queryFn: async () =>
      (await api<DataEnvelope<CategoryTemplateDto[]>>('/category-templates', { query: params })).data,
    enabled: scope.owner !== '',
  });
  return (
    <>
      <PageHeader title={t('catalog.categoriesTitle')} description={t('catalog.categoriesHint')} />
      <OwnerAndDiscipline
        permission="category.manage"
        owner={scope.owner}
        discipline={scope.discipline}
        onChange={onScope}
      />
      {scope.owner ? (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <QueryState isPending={groups.isPending} error={groups.error}>
              {() =>
                (groups.data ?? []).length === 0 ? (
                  <EmptyState title={t('common.noData')}>{t('catalog.noGroups')}</EmptyState>
                ) : (
                  <>
                    {(groups.data ?? []).map((g) => (
                      <AgeGroupCard key={g.id} group={g} />
                    ))}
                  </>
                )
              }
            </QueryState>
            <AgeGroupForm owner={scope.owner} discipline={scope.discipline} />
          </div>
          <TemplatesPanel
            owner={scope.owner}
            discipline={scope.discipline}
            groups={groups.data ?? []}
            templates={templates.data ?? []}
          />
        </div>
      ) : null}
    </>
  );
}

function AgeGroupCard({ group: g }: { group: AgeGroupDto }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const editable = g.allowedActions.includes('category.manage');
  const action = useAction();
  const [weight, setWeight] = useState({ gender: 'MALE' as Gender, kind: 'UP_TO', kg: '' });
  const remove = (path: string): void =>
    void action.run(async () => {
      await api(path, { method: 'DELETE' });
      await invalidateCatalog(queryClient);
    });
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {locale === 'en' ? g.name.en : g.name.ru}{' '}
            <span className="font-mono text-sm text-slate-500">{g.code}</span>
          </h2>
          <p className="text-sm text-slate-600">
            {t('catalog.ages', { from: g.ageFrom, to: g.ageTo })} · {t(`catalog.policies.${g.policy}`)}
          </p>
        </div>
        {editable ? (
          <Button
            size="sm"
            variant="ghost"
            loading={action.busy}
            onClick={() => remove(`/age-groups/${g.id}`)}
          >
            {t('catalog.deleteGroup')}
          </Button>
        ) : null}
      </div>
      {GENDERS.map((gender) => {
        const list = g.weightCategories.filter((w) => w.gender === gender);
        return (
          <div key={gender} className="mt-3">
            <p className="text-sm font-medium text-slate-700">{t(`people.genders.${gender}`)}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {list.length === 0 ? <li className="text-sm text-slate-500">—</li> : null}
              {list.map((w) => (
                <li
                  key={w.id}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm"
                >
                  {w.kind === 'ABOVE' ? '+' : ''}
                  {weightLabelKg(w.limitGrams, locale === 'en' ? 'en' : 'ru')} {t('catalog.kg')}
                  {editable ? (
                    <button
                      type="button"
                      className="ml-1 rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-red-700"
                      aria-label={t('catalog.deleteWeight')}
                      onClick={() => remove(`/weight-categories/${w.id}`)}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {editable ? (
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[auto_auto_8rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const grams = Math.round(Number(weight.kg.replace(',', '.')) * 1000);
            void action.run(async () => {
              const same = g.weightCategories.filter((w) => w.gender === weight.gender);
              await api('/weight-categories', {
                method: 'POST',
                body: {
                  ageGroupId: g.id,
                  gender: weight.gender,
                  kind: weight.kind,
                  limitGrams: grams,
                  sortOrder: weight.kind === 'ABOVE' ? 1000 : Math.min(999, same.length * 10),
                },
              });
              setWeight({ ...weight, kg: '' });
              await invalidateCatalog(queryClient);
            });
          }}
        >
          <Select
            aria-label={t('people.gender')}
            value={weight.gender}
            onChange={(e) => setWeight({ ...weight, gender: e.target.value as Gender })}
          >
            {GENDERS.map((x) => (
              <option key={x} value={x}>
                {t(`people.genders.${x}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('catalog.limitKind')}
            value={weight.kind}
            onChange={(e) => setWeight({ ...weight, kind: e.target.value })}
          >
            {WEIGHT_LIMIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`catalog.limitKinds.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            aria-label={t('catalog.kg')}
            inputMode="decimal"
            placeholder={t('catalog.kg')}
            value={weight.kg}
            onChange={(e) => setWeight({ ...weight, kg: e.target.value })}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!/^\d{2,3}([.,]\d)?$/.test(weight.kg)}
            loading={action.busy}
          >
            {t('catalog.addWeight')}
          </Button>
        </form>
      ) : null}
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
    </Card>
  );
}

function AgeGroupForm({ owner, discipline }: { owner: string; discipline: string }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const empty = { code: '', ru: '', en: '', policy: 'BY_BIRTH_YEAR', ageFrom: '', ageTo: '' };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  return (
    <Card>
      <CardTitle>{t('catalog.addGroup')}</CardTitle>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          void action.run(async () => {
            try {
              await api('/age-groups', {
                method: 'POST',
                body: {
                  disciplineCode: discipline,
                  code: v.code.trim().toUpperCase(),
                  name: { ru: v.ru.trim(), en: v.en.trim() || v.ru.trim() },
                  policy: v.policy,
                  ageFrom: Number(v.ageFrom),
                  ageTo: Number(v.ageTo),
                  ...ownerBody(owner),
                },
              });
              setV(empty);
              await invalidateCatalog(queryClient);
            } catch (err) {
              setErrors(fieldErrors(err));
              throw err;
            }
          });
        }}
      >
        {action.error ? (
          <Alert tone="danger" className="sm:col-span-2">
            {action.error}
          </Alert>
        ) : null}
        <Field id="ag-code" label={t('catalog.code')} hint={t('catalog.codeHint')} error={tf(errors.code)}>
          <Input id="ag-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        </Field>
        <Field id="ag-policy" label={t('catalog.policy')} error={tf(errors.policy)}>
          <Select id="ag-policy" value={v.policy} onChange={(e) => setV({ ...v, policy: e.target.value })}>
            {AGE_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(`catalog.policies.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ag-ru" label={t('catalog.nameRu')} error={tf(errors['name.ru'])}>
          <Input id="ag-ru" value={v.ru} onChange={(e) => setV({ ...v, ru: e.target.value })} />
        </Field>
        <Field id="ag-en" label={t('catalog.nameEn')} error={tf(errors['name.en'])}>
          <Input id="ag-en" value={v.en} onChange={(e) => setV({ ...v, en: e.target.value })} />
        </Field>
        <Field id="ag-from" label={t('catalog.ageFrom')} error={tf(errors.ageFrom)}>
          <Input
            id="ag-from"
            inputMode="numeric"
            value={v.ageFrom}
            onChange={(e) => setV({ ...v, ageFrom: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field id="ag-to" label={t('catalog.ageTo')} error={tf(errors.ageTo)}>
          <Input
            id="ag-to"
            inputMode="numeric"
            value={v.ageTo}
            onChange={(e) => setV({ ...v, ageTo: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={action.busy} disabled={!v.code || !v.ru || !v.ageFrom || !v.ageTo}>
            {t('catalog.addGroup')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
