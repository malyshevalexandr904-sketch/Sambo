'use client';
// Шаблоны наборов категорий (API.md, 4.5): набор «возрастная группа × пол × весовые категории».
import { type AgeGroupDto, type CategoryTemplateDto, GENDERS, weightLabelKg } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { fieldErrors } from '@/components/person-fields';
import { api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { useAction } from '@/lib/use-action';
import { ownerBody } from './owner-select';

export const invalidateCatalog = (queryClient: ReturnType<typeof useQueryClient>): Promise<void> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ['age-groups'] }),
    queryClient.invalidateQueries({ queryKey: ['category-templates'] }),
  ]).then(() => undefined);

export function TemplatesPanel({
  owner,
  discipline,
  groups,
  templates,
}: {
  owner: string;
  discipline: string;
  groups: AgeGroupDto[];
  templates: CategoryTemplateDto[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const options = groups
    .flatMap((g) =>
      GENDERS.map((gender) => ({
        key: `${g.id}:${gender}`,
        group: g,
        gender,
        weights: g.weightCategories.filter((w) => w.gender === gender),
      })),
    )
    .filter((o) => o.weights.length > 0);
  const toggle = (key: string): void => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  return (
    <Card>
      <CardTitle>{t('catalog.templates')}</CardTitle>
      <ul className="mb-4 space-y-2 text-sm">
        {templates.length === 0 ? <li className="text-slate-600">{t('catalog.noTemplates')}</li> : null}
        {templates.map((tpl) => (
          <li
            key={tpl.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2"
          >
            <span>
              <span className="font-medium">{tpl.name}</span> ·{' '}
              {t('catalog.categoryCount', { count: tpl.categoryCount })}
              <br />
              <span className="text-slate-600">
                {tpl.items.map((i) => `${i.ageGroupCode} ${t(`people.genders.${i.gender}`)}`).join(', ')}
              </span>
            </span>
            {tpl.allowedActions.includes('category.manage') ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void action.run(async () => {
                    await api(`/category-templates/${tpl.id}`, { method: 'DELETE' });
                    await invalidateCatalog(queryClient);
                  })
                }
              >
                {t('catalog.delete')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          const items = options
            .filter((o) => picked.has(o.key))
            .map((o) => ({
              ageGroupId: o.group.id,
              gender: o.gender,
              weightCategoryIds: o.weights.map((w) => w.id),
            }));
          void action.run(async () => {
            try {
              await api('/category-templates', {
                method: 'POST',
                body: { name: name.trim(), disciplineCode: discipline, items, ...ownerBody(owner) },
              });
              setName('');
              setPicked(new Set());
              await invalidateCatalog(queryClient);
            } catch (err) {
              setErrors(fieldErrors(err));
              throw err;
            }
          });
        }}
      >
        <p className="font-medium">{t('catalog.newTemplate')}</p>
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Field id="tpl-name" label={t('catalog.templateName')} error={tf(errors.name)}>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('catalog.templateItems')}</legend>
          {options.length === 0 ? <p className="text-sm text-slate-600">{t('catalog.needWeights')}</p> : null}
          <ul className="space-y-1">
            {options.map((o) => (
              <li key={o.key}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={picked.has(o.key)}
                    onChange={() => toggle(o.key)}
                  />
                  <span>
                    {locale === 'en' ? o.group.name.en : o.group.name.ru}, {t(`people.genders.${o.gender}`)}:{' '}
                    {o.weights
                      .map(
                        (w) =>
                          `${w.kind === 'ABOVE' ? '+' : ''}${weightLabelKg(w.limitGrams, locale === 'en' ? 'en' : 'ru')}`,
                      )
                      .join(', ')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Button
          type="submit"
          variant="secondary"
          loading={action.busy}
          disabled={name.trim().length < 2 || picked.size === 0}
        >
          {t('catalog.createTemplate')}
        </Button>
      </form>
    </Card>
  );
}
