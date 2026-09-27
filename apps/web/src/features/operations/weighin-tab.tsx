'use client';
// Экран взвешивания (API.md, 5.6; D-06): окно и весы, крупный ввод веса и мгновенный результат соответствия
// категории (та же функция, что на сервере), запись попытки, перевод по весу, если так решает положение.
import {
  attemptKindsForWindow,
  type CategoryRef,
  type CategoryWeight,
  type Competition,
  type DataEnvelope,
  gramsToKg,
  kgToGrams,
  type Page,
  WEIGH_IN_STATUSES,
  type WeighInAttemptKind,
  type WeighInOutcomeDto,
  weighInResult,
  type WeighInRow,
  type WeighInSettingsDto,
  type WeighInWindowDto,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select } from '@sde/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { useCategories } from '@/features/competitions/categories';
import { useWeightLabel } from '@/features/competitions/shared';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { athleteName, CheckInBadge, WeighInBadge } from './shared';
import { useScales, useWindows, WeighInSetup } from './weighin-setup';

interface Station {
  window: WeighInWindowDto | null;
  scaleId: string;
  settings: WeighInSettingsDto;
}

function Suggestions({
  row,
  suggested,
  canTransfer,
  onChanged,
}: {
  row: WeighInRow;
  suggested: (CategoryRef & { weight: CategoryWeight })[];
  canTransfer: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('weighin');
  const locale = useLocale();
  const weight = useWeightLabel();
  const action = useAction();
  if (suggested.length === 0) return null;
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="font-medium">{t('suggested')}</p>
      <div className="flex flex-wrap gap-2">
        {suggested.map((s) =>
          canTransfer ? (
            <Button
              key={s.id}
              size="sm"
              variant="secondary"
              loading={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api(`/entries/${row.entryId}/transfer-category`, {
                    method: 'POST',
                    body: { toCategoryId: s.id, reason: t('transferReason') },
                    version: row.entryVersion,
                  });
                  await onChanged();
                })
              }
            >
              {t('transferTo', { category: `${pickName(s.name, locale)} (${weight(s.weight)})` })}
            </Button>
          ) : (
            <Badge key={s.id} tone="info">
              {pickName(s.name, locale)}
            </Badge>
          ),
        )}
      </div>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
    </div>
  );
}

function WeighRow({
  row,
  station,
  canRecord,
  canTransfer,
  onChanged,
}: {
  row: WeighInRow;
  station: Station;
  canRecord: boolean;
  canTransfer: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('weighin');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const weightLabel = useWeightLabel();
  const [input, setInput] = useState('');
  const [outcome, setOutcome] = useState<WeighInOutcomeDto | null>(null);
  const action = useAction();
  const windowKinds = station.window ? attemptKindsForWindow(station.window.kind) : [];
  const kinds = row.record.allowedKinds.filter((k) => windowKinds.includes(k));
  const [kind, setKind] = useState<WeighInAttemptKind | ''>('');
  const chosen = kind && kinds.includes(kind) ? kind : (kinds[0] ?? '');
  const grams = kgToGrams(input);
  const inCategory = station.window?.categories.some((x) => x.id === row.category.id) ?? false;
  const preview =
    grams !== null && grams >= 10_000
      ? weighInResult(grams, row.category.weight, station.settings.toleranceGrams)
      : null;
  const last = row.record.lastAttempt;
  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{athleteName(row.athlete)}</p>
        <span className="text-sm text-slate-600">
          {pickName(row.category.name, locale)} · {row.organization.shortName || row.organization.name}
        </span>
        <WeighInBadge status={row.record.status} />
        {row.checkIn.status !== 'ARRIVED' ? <CheckInBadge status={row.checkIn.status} /> : null}
      </div>
      <p className="text-xs text-slate-600">
        {last ? t('lastWeight', { weight: gramsToKg(last.weightGrams, lang) }) : null}
        {!last && row.declaredWeightGrams !== null
          ? t('declared', { weight: gramsToKg(row.declaredWeightGrams, lang) })
          : null}
      </p>
      {canRecord && inCategory && chosen && station.scaleId ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (grams === null || !station.window) return;
            void action.run(async () => {
              const r = await api<DataEnvelope<WeighInOutcomeDto>>(`/entries/${row.entryId}/weigh-ins`, {
                method: 'POST',
                body: {
                  windowId: station.window?.id,
                  scaleId: station.scaleId,
                  weightGrams: grams,
                  kind: chosen,
                },
                idempotencyKey: crypto.randomUUID(),
              });
              setOutcome(r.data);
              setInput('');
              await onChanged();
            });
          }}
        >
          <Field
            id={`w-${row.entryId}`}
            label={t('weight')}
            error={input && grams === null ? t('weightInvalid') : undefined}
          >
            <Input
              id={`w-${row.entryId}`}
              inputMode="decimal"
              autoComplete="off"
              className="w-36 text-2xl font-semibold"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          {kinds.length > 1 ? (
            <Field id={`k-${row.entryId}`} label={t('kind')}>
              <Select
                id={`k-${row.entryId}`}
                value={chosen}
                onChange={(e) => setKind(e.target.value as WeighInAttemptKind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Badge tone="neutral">{t(`kinds.${chosen}`)}</Badge>
          )}
          <Button type="submit" loading={action.busy} disabled={grams === null}>
            {t('record')}
          </Button>
          {preview ? (
            <span role="status" aria-live="polite">
              <Badge tone={preview === 'PASSED' ? 'success' : 'danger'}>
                {t('preview', {
                  result: t(`results.${preview}`),
                  category: weightLabel(row.category.weight),
                })}
              </Badge>
            </span>
          ) : null}
        </form>
      ) : null}
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      {outcome ? (
        <div className="mt-2" role="status">
          <p className="text-sm">
            {t('recorded', {
              kind: t(`kinds.${outcome.attempt.kind}`),
              weight: gramsToKg(outcome.attempt.weightGrams, lang),
              result: t(`results.${outcome.attempt.result}`),
            })}
          </p>
          <Suggestions
            row={row}
            suggested={outcome.suggestedCategories ?? []}
            canTransfer={canTransfer}
            onChanged={onChanged}
          />
        </div>
      ) : null}
    </li>
  );
}

export function WeighInTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('weighin');
  const outcomes = useTranslations('competitions.outcomes');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useCategories(c.id);
  const windows = useWindows(c.id);
  const scales = useScales(c.id);
  const settings = useQuery({
    queryKey: ['competitions', c.id, 'weigh-in', 'settings'],
    queryFn: async () =>
      (await api<DataEnvelope<WeighInSettingsDto>>(`/competitions/${c.id}/weigh-in/settings`)).data,
  });
  const [windowId, setWindowId] = useState('');
  const [scaleId, setScaleId] = useState('');
  const [filters, setFilters] = useState({ categoryId: '', status: '', q: '' });
  const openWindows = (windows.data ?? []).filter((w) => w.open);
  const current = (windows.data ?? []).find((w) => w.id === windowId) ?? openWindows[0] ?? null;
  const verified = (scales.data ?? []).filter((s) => s.verified);
  const scale = scaleId || verified[0]?.id || '';
  const params = {
    windowId: current?.id,
    categoryId: filters.categoryId || undefined,
    status: filters.status || undefined,
    q: filters.q.trim() || undefined,
  };
  const list = useInfiniteQuery({
    queryKey: ['competitions', c.id, 'weigh-in', params],
    queryFn: ({ pageParam }) =>
      api<Page<WeighInRow>>(`/competitions/${c.id}/weigh-in`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  return (
    <div className="space-y-6">
      {settings.data ? (
        <p className="text-sm text-slate-600">
          {t('settings', {
            tolerance: settings.data.toleranceGrams,
            outcome: outcomes(settings.data.failureOutcome),
          })}
        </p>
      ) : null}
      <WeighInSetup competition={c} />
      <Card>
        <CardTitle>{t('stationTitle')}</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="st-window" label={t('window')}>
            <Select id="st-window" value={current?.id ?? ''} onChange={(e) => setWindowId(e.target.value)}>
              {(windows.data ?? []).length === 0 ? <option value="">{t('chooseWindow')}</option> : null}
              {(windows.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.open ? ` · ${t('windowOpen')}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="st-scale" label={t('scale')}>
            <Select id="st-scale" value={scale} onChange={(e) => setScaleId(e.target.value)}>
              {(scales.data ?? []).map((s) => (
                <option key={s.id} value={s.id} disabled={!s.verified}>
                  {s.name}
                  {s.verified ? '' : ` · ${t('scaleExpired')}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="st-category" label={t('windowCategories')}>
            <Select
              id="st-category"
              value={filters.categoryId}
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
            >
              <option value="">{t('allCategoriesOption')}</option>
              {(categories.data ?? [])
                .filter((x) => !current || current.categories.some((wc) => wc.id === x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {pickName(x.name, locale)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="st-status" label={t('status')}>
            <Select
              id="st-status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{t('allStatuses')}</option>
              {WEIGH_IN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="st-q" label={t('search')}>
            <Input
              id="st-q"
              type="search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              maxLength={100}
            />
          </Field>
        </div>
        {current && !current.open ? (
          <Alert tone="warning" className="mt-3">
            {t('noOpenWindow')}
          </Alert>
        ) : null}
      </Card>
      <QueryState isPending={list.isPending || !settings.data} error={list.error ?? settings.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {rows.map((r) => (
                <WeighRow
                  key={r.entryId}
                  row={r}
                  station={{
                    window: current?.open ? current : null,
                    scaleId: scale,
                    settings: settings.data as WeighInSettingsDto,
                  }}
                  canRecord={c.allowedActions.includes('weighin.record')}
                  canTransfer={c.allowedActions.includes('entry.transfer')}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )
        }
      </QueryState>
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
