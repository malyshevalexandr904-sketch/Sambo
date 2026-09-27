'use client';
// Мандатная комиссия (API.md, 5.4; G-06): допуск одобренных участий с проверками и причинами, прибытие и
// взвешивание в одной строке, исключение проверки с причиной (право `admission.override`).
import {
  ADMISSION_CHECK_KINDS,
  ADMISSION_STATUSES,
  type AdmissionRow,
  type Competition,
  gramsToKg,
  type Page,
} from '@sde/contracts';
import { Alert, Button, EmptyState, Field, Input, Select, Table, Td, Th } from '@sde/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { useCategories } from '@/features/competitions/categories';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { AdmissionBadge, athleteName, CheckChip, CheckInBadge, WeighInBadge } from './shared';

export function AdmissionTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('admission');
  const tw = useTranslations('weighin');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useCategories(c.id);
  const [filters, setFilters] = useState({
    categoryId: '',
    status: '',
    checkKind: '',
    q: '',
    problemsOnly: false,
  });
  const params = {
    categoryId: filters.categoryId || undefined,
    status: filters.status || undefined,
    checkKind: filters.checkKind || undefined,
    q: filters.q.trim() || undefined,
    problemsOnly: filters.problemsOnly || undefined,
  };
  const list = useInfiniteQuery({
    queryKey: ['competitions', c.id, 'admission', params],
    queryFn: ({ pageParam }) =>
      api<Page<AdmissionRow>>(`/competitions/${c.id}/admission`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  const recompute = useAction();
  const [done, setDone] = useState(false);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('hint')}</p>
      {c.allowedActions.includes('admission.override') ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            loading={recompute.busy}
            onClick={() =>
              void recompute.run(async () => {
                await api(`/competitions/${c.id}/admission/recompute`, { method: 'POST' });
                setDone(true);
                await refresh();
              })
            }
          >
            {t('recompute')}
          </Button>
          {done ? (
            <span role="status" className="text-sm text-slate-600">
              {t('recomputed')}
            </span>
          ) : null}
          {recompute.error ? <Alert tone="danger">{recompute.error}</Alert> : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field id="adm-category" label={t('category')}>
          <Select
            id="adm-category"
            value={filters.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          >
            <option value="">{t('allStatuses')}</option>
            {(categories.data ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {pickName(cat.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="adm-status" label={t('status')}>
          <Select id="adm-status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">{t('allStatuses')}</option>
            {ADMISSION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="adm-check" label={t('checkKind')}>
          <Select
            id="adm-check"
            value={filters.checkKind}
            onChange={(e) => set({ checkKind: e.target.value })}
          >
            <option value="">{t('anyCheck')}</option>
            {ADMISSION_CHECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`checkKinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="adm-q" label={t('search')}>
          <Input
            id="adm-q"
            type="search"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            maxLength={100}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={filters.problemsOnly}
            onChange={(e) => set({ problemsOnly: e.target.checked })}
          />
          {t('problemsOnly')}
        </label>
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('athlete')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('checks')}</Th>
                  <Th>{t('checkIn')}</Th>
                  <Th>{t('weighIn')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entryId} className="align-top">
                    <Td>
                      <p className="font-medium">{athleteName(r.athlete)}</p>
                      <p className="text-xs text-slate-600">
                        {r.organization.shortName || r.organization.name} ·{' '}
                        {pickName(r.category.name, locale)}
                      </p>
                    </Td>
                    <Td>
                      <AdmissionBadge status={r.admission.status} />
                    </Td>
                    <Td>
                      <ChecksCell row={r} onChanged={refresh} />
                    </Td>
                    <Td>
                      <CheckInBadge status={r.checkIn.status} />
                    </Td>
                    <Td>
                      <WeighInBadge status={r.weighIn.status} />
                      {r.weighIn.lastWeightGrams !== null ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {tw('lastWeight', {
                            weight: gramsToKg(r.weighIn.lastWeightGrams, locale === 'en' ? 'en' : 'ru'),
                          })}
                        </p>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
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

function ChecksCell({ row, onChanged }: { row: AdmissionRow; onChanged: () => Promise<unknown> }) {
  const t = useTranslations('admission');
  const a = row.admission;
  if (a.checks.length === 0) return <p className="text-sm text-slate-600">{t('noChecks')}</p>;
  const waivable = a.allowedActions
    .filter((x) => x.startsWith('waive:'))
    .map((x) => x.slice('waive:'.length));
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {a.checks.map((check) => (
          <CheckChip key={check.kind} check={check} />
        ))}
      </ul>
      {waivable.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {waivable.map((kind) => (
            <ReasonAction
              key={kind}
              size="sm"
              label={t('waive', { kind: t(`checkKinds.${kind}`) })}
              title={t('waiveTitle', { kind: t(`checkKinds.${kind}`), name: row.athlete.publicName })}
              description={t('waiveHint')}
              onConfirm={async (reason) => {
                await api(`/entries/${row.entryId}/admission/checks/${kind}/waive`, {
                  method: 'POST',
                  body: { reason },
                });
                await onChanged();
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
