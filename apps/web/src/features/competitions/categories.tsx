'use client';
// Категории турнира (API.md, 5.2): генерация из шаблона, добавление и правка, переходы (C-03), объединение
// маленьких категорий до жеребьёвки (D-03). Совместимость спортсменов считает только сервер.
import {
  type CategoryTemplateDto,
  type Competition,
  type CompetitionCategoryDto,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Select, Table, Td, Th } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { pickName, qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { AddCategoryCard } from './category-form';
import { CategoryStatusBadge, useFailedText, useInvalidateCompetition, useWeightLabel } from './shared';

export function useCategories(competitionId: string, enabled = true) {
  return useQuery({
    queryKey: qk.competitionCategories(competitionId),
    queryFn: async () =>
      (
        await api<Page<CompetitionCategoryDto>>(`/competitions/${competitionId}/categories`, {
          query: { limit: 500 },
        })
      ).data,
    enabled,
  });
}

/** Возраст категории: «12–13 лет · 2012–2013 г. р.»; открытая граница — многоточие. */
export function useAgeLabel(): (c: Pick<CompetitionCategoryDto, 'age'>) => string {
  const t = useTranslations('competitions.categories');
  return ({ age }) => {
    const parts: string[] = [];
    if (age.ageFrom !== null || age.ageTo !== null)
      parts.push(t('ages', { from: age.ageFrom ?? '…', to: age.ageTo ?? '…' }));
    if (age.birthYearFrom !== null || age.birthYearTo !== null)
      parts.push(t('birthYears', { from: age.birthYearFrom ?? '…', to: age.birthYearTo ?? '…' }));
    return parts.join(' · ');
  };
}

export function CategoriesTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions.categories');
  const locale = useLocale();
  const list = useCategories(c.id);
  const weight = useWeightLabel();
  const age = useAgeLabel();
  const manage = c.allowedActions.includes('competition_category.manage');
  const editablePhase = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(c.status);
  return (
    <div className="space-y-6">
      {manage && editablePhase ? (
        <GenerateCard competition={c} hasCategories={(list.data ?? []).length > 0} />
      ) : null}
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          (list.data ?? []).length === 0 ? (
            <EmptyState title={t('empty')}>{manage ? t('emptyHint') : null}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('name')}</Th>
                  <Th>{t('age')}</Th>
                  <Th>{t('weight')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('entries')}</Th>
                  <Th>{t('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((cat) => (
                  <tr key={cat.id}>
                    <Td>
                      <p className="font-medium">{pickName(cat.name, locale)}</p>
                      <p className="font-mono text-xs text-slate-500">{cat.code}</p>
                    </Td>
                    <Td>{age(cat)}</Td>
                    <Td>{weight(cat.weight)}</Td>
                    <Td>
                      <CategoryStatusBadge status={cat.status} />
                    </Td>
                    <Td>
                      {cat.entries.approved} / {cat.entries.active}
                    </Td>
                    <Td>
                      <CategoryActions competition={c} category={cat} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
      {c.allowedActions.includes('category.merge') && (list.data ?? []).length > 1 ? (
        <MergeCard competition={c} categories={list.data ?? []} />
      ) : null}
      {manage && editablePhase ? <AddCategoryCard competition={c} /> : null}
    </div>
  );
}

function CategoryActions({
  competition: c,
  category,
}: {
  competition: Competition;
  category: CompetitionCategoryDto;
}) {
  const t = useTranslations('competitions.categories');
  const errorMessage = useErrorMessage();
  const failedText = useFailedText();
  const invalidate = useInvalidateCompetition(c.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = category.allowedActions.filter((a) => a.startsWith('transition:')).map((a) => a.slice(11));
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await invalidate();
    } catch (e) {
      const failed = e instanceof ApiError ? ((e.details?.failed as string[] | undefined) ?? []) : [];
      setError(`${errorMessage(e)} ${failedText(failed)}`.trim());
    } finally {
      setBusy(false);
    }
  };
  const transition = (to: string, reason?: string): Promise<void> =>
    run(() =>
      api(`/competitions/${c.id}/categories/${category.id}/transitions`, {
        method: 'POST',
        body: { to, reason },
        version: category.version,
      }),
    );
  return (
    <div className="flex max-w-xs flex-wrap gap-2">
      {error ? (
        <Alert tone="danger" className="w-full">
          {error}
        </Alert>
      ) : null}
      {targets.map((to) =>
        to === 'CANCELLED' || (category.status === 'CLOSED' && to === 'REGISTRATION') ? (
          <ReasonAction
            key={to}
            size="sm"
            variant={to === 'CANCELLED' ? 'danger' : 'secondary'}
            label={t(`transitionTo.${to}`)}
            title={t(`transitionTitle.${to}`)}
            onConfirm={(reason) => transition(to, reason)}
          />
        ) : (
          <Button key={to} size="sm" variant="secondary" loading={busy} onClick={() => void transition(to)}>
            {t(`transitionTo.${to}`)}
          </Button>
        ),
      )}
      {category.allowedActions.includes('category.delete') ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() =>
            void run(() => api(`/competitions/${c.id}/categories/${category.id}`, { method: 'DELETE' }))
          }
        >
          {t('delete')}
        </Button>
      ) : null}
    </div>
  );
}

function GenerateCard({
  competition: c,
  hasCategories,
}: {
  competition: Competition;
  hasCategories: boolean;
}) {
  const t = useTranslations('competitions.categories');
  const invalidate = useInvalidateCompetition(c.id);
  const action = useAction();
  const params = { disciplineCode: c.disciplineCode };
  const templates = useQuery({
    queryKey: qk.categoryTemplates(params),
    queryFn: async () =>
      (await api<DataEnvelope<CategoryTemplateDto[]>>('/category-templates', { query: params })).data,
  });
  const available = (templates.data ?? []).filter((x) => x.owner === null || x.owner.id === c.organizer.id);
  const [templateId, setTemplateId] = useState('');
  const [replace, setReplace] = useState(false);
  const selected = templateId || available[0]?.id || '';
  return (
    <Card>
      <CardTitle>{t('generateTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('generateHint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      {available.length === 0 && !templates.isPending ? (
        <p className="text-sm text-slate-600">{t('noTemplates')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field id="gen-template" label={t('template')} className="min-w-64 flex-1">
            <Select id="gen-template" value={selected} onChange={(e) => setTemplateId(e.target.value)}>
              {available.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({t('templateSize', { count: x.categoryCount })})
                </option>
              ))}
            </Select>
          </Field>
          {hasCategories ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              {t('replaceExisting')}
            </label>
          ) : null}
          <Button
            loading={action.busy}
            disabled={!selected}
            onClick={() =>
              void action.run(async () => {
                await api(`/competitions/${c.id}/categories/generate`, {
                  method: 'POST',
                  body: { templateId: selected, replaceExisting: replace },
                });
                await invalidate();
              })
            }
          >
            {t('generate')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function MergeCard({
  competition: c,
  categories,
}: {
  competition: Competition;
  categories: CompetitionCategoryDto[];
}) {
  const t = useTranslations('competitions.categories');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const failedText = useFailedText();
  const invalidate = useInvalidateCompetition(c.id);
  const mergeable = categories.filter((x) => x.allowedActions.includes('category.merge'));
  const [target, setTarget] = useState('');
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const targetId = target || mergeable[0]?.id || '';
  const candidates = mergeable.filter(
    (x) => x.id !== targetId && x.gender === mergeable.find((m) => m.id === targetId)?.gender,
  );
  return (
    <Card>
      <CardTitle>{t('mergeTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('mergeHint')}</p>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Field id="merge-target" label={t('mergeTarget')}>
        <Select
          id="merge-target"
          value={targetId}
          onChange={(e) => {
            setTarget(e.target.value);
            setSources(new Set());
          }}
        >
          {mergeable.map((x) => (
            <option key={x.id} value={x.id}>
              {pickName(x.name, locale)} ({x.entries.active})
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-slate-700">{t('mergeSources')}</legend>
        <ul className="mt-1 space-y-1">
          {candidates.map((x) => (
            <li key={x.id}>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={sources.has(x.id)}
                  onChange={(e) => {
                    const next = new Set(sources);
                    if (e.target.checked) next.add(x.id);
                    else next.delete(x.id);
                    setSources(next);
                  }}
                />
                {pickName(x.name, locale)} ({x.entries.active})
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {sources.size > 0 ? (
        <div className="mt-3">
          <ReasonAction
            label={t('merge')}
            title={t('mergeConfirm', { count: sources.size })}
            onConfirm={async (reason) => {
              setError(null);
              try {
                await api(`/competitions/${c.id}/categories/merge`, {
                  method: 'POST',
                  body: { sourceCategoryIds: [...sources], targetCategoryId: targetId, reason },
                });
                setSources(new Set());
                await invalidate();
              } catch (e) {
                const failed =
                  e instanceof ApiError ? ((e.details?.failed as string[] | undefined) ?? []) : [];
                setError(`${errorMessage(e)} ${failedText(failed)}`.trim());
              }
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
