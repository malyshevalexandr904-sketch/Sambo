'use client';
// Прибытие (API.md, 5.5; раздел 15 ТЗ): счётчики, сканер QR, поиск и отметка. Отметка — одна на спортсмена,
// допуск всех его участий пересчитывает сервер.
import {
  CHECK_IN_STATUSES,
  type CheckInMethod,
  type CheckInRow,
  type CheckInSummaryDto,
  type Competition,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, Select } from '@sde/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { QrScanner } from './qr-scanner';
import { AdmissionSummaryView, athleteName, CheckInBadge } from './shared';

const CHECK_IN_PHASE = ['CHECK_IN', 'DRAWING', 'SCHEDULED', 'IN_PROGRESS'];

const newKey = (): string => crypto.randomUUID();

function SummaryCard({ competitionId }: { competitionId: string }) {
  const t = useTranslations('checkin.summary');
  const summary = useQuery({
    queryKey: ['competitions', competitionId, 'check-in', 'summary'],
    queryFn: async () =>
      (await api<DataEnvelope<CheckInSummaryDto>>(`/competitions/${competitionId}/check-in/summary`)).data,
    refetchInterval: 30_000,
  });
  const keys = [
    'declared',
    'approved',
    'arrived',
    'expected',
    'notArrived',
    'withdrawn',
    'problemDocuments',
  ] as const;
  return (
    <QueryState isPending={summary.isPending} error={summary.error}>
      {() => (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-live="polite">
          {keys.map((k) => (
            <div key={k} className="rounded-md bg-slate-50 p-3">
              <dt className="text-xs text-slate-600">{t(k)}</dt>
              <dd className="text-2xl font-semibold">{summary.data?.[k] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
    </QueryState>
  );
}

/** Карточка спортсмена: участия с допуском, прибытие и кнопки отметки. */
export function CheckInCard({
  competitionId,
  row,
  method,
  onChanged,
}: {
  competitionId: string;
  row: CheckInRow;
  method: CheckInMethod;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('checkin');
  const locale = useLocale();
  const action = useAction();
  const targets = row.checkIn.allowedActions.filter((a) => a.startsWith('set:')).map((a) => a.slice(4));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{athleteName(row.athlete)}</p>
        <span className="text-xs text-slate-600">{row.athlete.birthDate.slice(0, 4)}</span>
        <CheckInBadge status={row.checkIn.status} />
        {row.checkIn.arrivedAt ? (
          <span className="text-xs text-slate-600">
            {t('since', { time: formatDateTime(row.checkIn.arrivedAt, locale) })}
            {row.checkIn.method ? ` · ${t(`methods.${row.checkIn.method}`)}` : ''}
          </span>
        ) : null}
      </div>
      <ul className="space-y-1 text-sm">
        {row.entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <span>
              {pickName(e.category.name, locale)} · {e.organization.shortName || e.organization.name}
            </span>
            <AdmissionSummaryView summary={e.admission} />
          </li>
        ))}
      </ul>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {targets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {targets.map((to) => {
            const mark = (note?: string) =>
              api(`/competitions/${competitionId}/check-in/${row.athlete.id}`, {
                method: 'POST',
                body: { status: to, method, note },
                version: row.checkIn.version,
              }).then(onChanged);
            // Снятие окончательно (участие не допускается) — только с причиной.
            if (to === 'WITHDRAWN')
              return (
                <ReasonAction
                  key={to}
                  size="sm"
                  label={t(`set.${to}`)}
                  title={t('withdrawTitle', { name: row.athlete.publicName })}
                  onConfirm={async (reason) => {
                    await mark(reason);
                  }}
                />
              );
            return (
              <Button
                key={to}
                size={to === 'ARRIVED' ? 'md' : 'sm'}
                variant={to === 'ARRIVED' ? 'primary' : 'secondary'}
                loading={action.busy}
                onClick={() => void action.run(() => mark())}
              >
                {t(`set.${to}`)}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ScanCard({
  competition: c,
  onChanged,
}: {
  competition: Competition;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('checkin');
  const action = useAction();
  const [found, setFound] = useState<CheckInRow | null>(null);
  const scan = useCallback(
    (qrToken: string) =>
      void action.run(async () => {
        const r = await api<DataEnvelope<CheckInRow>>(`/competitions/${c.id}/check-in/scan`, {
          method: 'POST',
          body: { qrToken },
          idempotencyKey: newKey(),
        });
        setFound(r.data);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- action.run стабилен
    [c.id],
  );
  const reload = async (): Promise<void> => {
    if (found) {
      const rows = await api<Page<CheckInRow>>(`/competitions/${c.id}/check-in`, {
        query: { q: found.athlete.lastName, limit: 100 },
      });
      setFound(rows.data.find((r) => r.athlete.id === found.athlete.id) ?? null);
    }
    await onChanged();
  };
  return (
    <Card>
      <CardTitle>{t('scanTitle')}</CardTitle>
      <QrScanner onToken={scan} busy={action.busy} />
      {action.error ? (
        <Alert tone="danger" className="mt-3">
          {action.error}
        </Alert>
      ) : null}
      {found ? (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3" role="status">
          <p className="mb-2 text-xs font-medium uppercase text-blue-800">{t('scanned')}</p>
          <CheckInCard competitionId={c.id} row={found} method="QR" onChanged={reload} />
        </div>
      ) : null}
    </Card>
  );
}

export function CheckInTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('checkin');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const params = { status: status || undefined, q: q.trim() || undefined };
  const list = useInfiniteQuery({
    queryKey: ['competitions', c.id, 'check-in', params],
    queryFn: ({ pageParam }) =>
      api<Page<CheckInRow>>(`/competitions/${c.id}/check-in`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  const open = CHECK_IN_PHASE.includes(c.status);
  return (
    <div className="space-y-6">
      <SummaryCard competitionId={c.id} />
      {!open ? <Alert tone="info">{t('closedHint')}</Alert> : null}
      {open && c.allowedActions.includes('checkin.perform') ? (
        <ScanCard competition={c} onChanged={refresh} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ci-q" label={t('search')}>
          <Input id="ci-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </Field>
        <Field id="ci-status" label={t('status')}>
          <Select id="ci-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allStatuses')}</option>
            {CHECK_IN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {rows.map((r) => (
                <li key={r.athlete.id} className="p-3">
                  <CheckInCard competitionId={c.id} row={r} method="SEARCH" onChanged={refresh} />
                </li>
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
