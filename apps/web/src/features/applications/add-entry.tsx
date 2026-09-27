'use client';
// Добавление спортсмена клуба в заявку (API.md, 5.3): совместимые категории и причины несовместимости считает
// сервер (eligible-categories); заявленный вес необязателен — окончательно решает взвешивание.
import type {
  ApplicationDto,
  AthleteSummary,
  DataEnvelope,
  EligibleCategoriesDto,
  Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { useWeightLabel } from '@/features/competitions/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pickName, qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function AddEntryCard({
  application: a,
  onAdded,
}: {
  application: ApplicationDto;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations('applications');
  const tr = useTranslations('applications.reasons');
  const locale = useLocale();
  const weightLabel = useWeightLabel();
  const action = useAction();
  const [search, setSearch] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const grams = weightKg ? Math.round(Number(weightKg.replace(',', '.')) * 1000) : null;
  const validWeight = grams === null || (Number.isFinite(grams) && grams >= 10_000 && grams <= 250_000);
  const athletesParams = {
    organizationId: a.organization.id,
    q: search.trim() || undefined,
    status: 'ACTIVE',
  };
  const athletes = useQuery({
    queryKey: qk.athletes(athletesParams),
    queryFn: async () =>
      (await api<Page<AthleteSummary>>('/athletes', { query: { ...athletesParams, limit: 50 } })).data,
  });
  const eligible = useQuery({
    queryKey: qk.eligible(a.competition.id, athleteId, validWeight ? grams : null),
    queryFn: async () =>
      (
        await api<DataEnvelope<EligibleCategoriesDto>>(
          `/competitions/${a.competition.id}/eligible-categories`,
          {
            query: { athleteId, declaredWeightGrams: validWeight ? grams : undefined },
          },
        )
      ).data,
    enabled: athleteId !== '',
  });
  const add = (categoryId: string): Promise<unknown> =>
    action.run(async () => {
      await api(`/applications/${a.id}/entries`, {
        method: 'POST',
        body: {
          athleteId,
          categoryId,
          declaredWeightGrams: validWeight && grams !== null ? grams : undefined,
        },
      });
      await onAdded();
      await eligible.refetch();
    });
  return (
    <Card>
      <CardTitle>{t('addTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('addHint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="add-search" label={t('searchAthlete')}>
          <Input
            id="add-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Field id="add-athlete" label={t('athlete')}>
          <Select id="add-athlete" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">{athletes.isPending ? '…' : t('chooseAthlete')}</option>
            {(athletes.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {[x.lastName, x.firstName, x.middleName].filter(Boolean).join(' ')} ·{' '}
                {formatDate(x.birthDate, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="add-weight"
          label={t('declaredWeightKg')}
          hint={t('declaredWeightHint')}
          error={validWeight ? undefined : t('weightInvalid')}
        >
          <Input
            id="add-weight"
            inputMode="decimal"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </Field>
      </div>
      {athleteId ? (
        <div className="mt-4">
          <QueryState isPending={eligible.isPending} error={eligible.error}>
            {() =>
              eligible.data ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 font-medium">{t('eligibleTitle')}</p>
                    {eligible.data.eligible.length === 0 ? (
                      <p className="text-sm text-slate-600">{t('noEligible')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {eligible.data.eligible.map((c) => (
                          <li
                            key={c.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3"
                          >
                            <div>
                              <p className="font-medium">{pickName(c.name, locale)}</p>
                              <p className="text-xs text-slate-600">
                                {weightLabel(c.weight)}
                                {c.weightMatch === false ? ` · ${t('weightMismatch')}` : ''}
                              </p>
                            </div>
                            <Button size="sm" loading={action.busy} onClick={() => void add(c.id)}>
                              {t('addToCategory')}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {eligible.data.ineligible.length > 0 ? (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                        {t('ineligibleTitle', { count: eligible.data.ineligible.length })}
                      </summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {eligible.data.ineligible.map(({ category, reasons }) => (
                          <li key={category.id}>
                            <span className="font-medium">{pickName(category.name, locale)}</span>
                            {': '}
                            {reasons.map((r) => (tr.has(r) ? tr(r) : r)).join('; ')}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null
            }
          </QueryState>
        </div>
      ) : null}
    </Card>
  );
}
