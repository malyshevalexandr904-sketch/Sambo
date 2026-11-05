'use client';
// Добавление спортсмена клуба в заявку (API.md, 5.3): совместимые категории и причины несовместимости считает
// сервер (eligible-categories); заявленный вес необязателен — окончательно решает взвешивание.
// Порядок (правки 05.11.2026): спортсмен, подходящий по возрасту → весовая категория → документы → отправка заявки.
// Тренер видит только своих спортсменов; руководитель клуба указывает тренера клуба для каждого спортсмена.
import type {
  ApplicationDto,
  Athlete,
  AthleteSummary,
  CoachSummary,
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
import { AthleteDocuments } from '@/features/documents/athlete-documents';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pickName, qk, useMe } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

/** Категории, куда проходит заявленный вес, — первыми; порядок турнира внутри групп сохраняется. */
function byWeightMatch<T extends { weightMatch: boolean | null }>(list: T[]): T[] {
  const rank = (c: T): number => (c.weightMatch === true ? 0 : c.weightMatch === null ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

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
  const { data: me } = useMe();
  const coachRole = me?.activeRole === 'COACH';
  const headRole = me?.activeRole === 'ORGANIZATION_HEAD';
  const [search, setSearch] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [added, setAdded] = useState<{ athleteId: string; name: string } | null>(null);
  const [weightKg, setWeightKg] = useState('');
  const grams = weightKg ? Math.round(Number(weightKg.replace(',', '.')) * 1000) : null;
  const validWeight = grams === null || (Number.isFinite(grams) && grams >= 10_000 && grams <= 250_000);
  const athletesParams = {
    organizationId: a.organization.id,
    q: search.trim() || undefined,
    status: 'ACTIVE',
    // Тренер заявляет только своих спортсменов.
    mine: coachRole ? 'true' : undefined,
  };
  const athletes = useQuery({
    queryKey: qk.athletes(athletesParams),
    queryFn: async () =>
      (await api<Page<AthleteSummary>>('/athletes', { query: { ...athletesParams, limit: 50 } })).data,
  });
  const coachesParams = { organizationId: a.organization.id, status: 'ACTIVE', limit: 100 };
  const coaches = useQuery({
    queryKey: qk.coaches(coachesParams),
    queryFn: async () => (await api<Page<CoachSummary>>('/coaches', { query: coachesParams })).data,
    enabled: !coachRole,
  });
  const chosenAthlete = (athletes.data ?? []).find((x) => x.id === athleteId);
  const needCoach = headRole && !coachId;
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
          coachId: !coachRole && coachId ? coachId : undefined,
        },
      });
      await onAdded();
      await eligible.refetch();
      if (chosenAthlete)
        setAdded({
          athleteId,
          name: [chosenAthlete.lastName, chosenAthlete.firstName].filter(Boolean).join(' '),
        });
    });
  const reset = (): void => {
    setAdded(null);
    setAthleteId('');
    setCoachId('');
    setWeightKg('');
  };
  if (added) return <DocumentsStep added={added} onAnother={reset} />;
  return (
    <Card>
      <CardTitle>{t('addTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('addHint')}</p>
      <ol className="mb-4 grid gap-2 text-sm sm:grid-cols-4" aria-label={t('stepsLabel')}>
        {(['stepAthlete', 'stepCategory', 'stepDocuments', 'stepSubmit'] as const).map((s, i) => (
          <li
            key={s}
            className={
              (i === 0 && !athleteId) || (i === 1 && athleteId)
                ? 'flex gap-2 rounded-md bg-blue-50 p-2 font-medium text-blue-900'
                : 'flex gap-2 rounded-md bg-slate-50 p-2 text-slate-600'
            }
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-700 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            {t(s)}
          </li>
        ))}
      </ol>
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
          <Select
            id="add-athlete"
            value={athleteId}
            onChange={(e) => {
              setAthleteId(e.target.value);
              // Тренер по умолчанию — из карточки спортсмена, если он тренер этого клуба.
              const next = (athletes.data ?? []).find((x) => x.id === e.target.value);
              setCoachId(next?.coach?.id ?? '');
            }}
          >
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
        {!coachRole ? (
          <Field
            id="add-coach"
            label={headRole ? t('coachRequired') : t('coachOptional')}
            hint={t('coachHint')}
            error={athleteId && needCoach ? t('coachNeeded') : undefined}
          >
            <Select id="add-coach" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              <option value="">{coaches.isPending ? '…' : t('chooseCoach')}</option>
              {(coaches.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
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
                        {byWeightMatch(eligible.data.eligible).map((c) => (
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
                            <Button
                              size="sm"
                              loading={action.busy}
                              disabled={needCoach}
                              onClick={() => void add(c.id)}
                            >
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

/** Шаг 3: документы добавленного спортсмена (паспорт или свидетельство, медицинский допуск, страховка). */
function DocumentsStep({
  added,
  onAnother,
}: {
  added: { athleteId: string; name: string };
  onAnother: () => void;
}) {
  const t = useTranslations('applications');
  const athlete = useQuery({
    queryKey: qk.athlete(added.athleteId),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${added.athleteId}`)).data,
  });
  return (
    <div className="space-y-3">
      <Alert tone="success" title={t('addedTitle', { name: added.name })}>
        {t('addedText')}
      </Alert>
      <QueryState isPending={athlete.isPending} error={athlete.error}>
        {() => (athlete.data ? <AthleteDocuments athlete={athlete.data} /> : null)}
      </QueryState>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onAnother}>{t('addAnother')}</Button>
        <p className="text-sm text-slate-600">{t('thenSubmit')}</p>
      </div>
    </div>
  );
}
