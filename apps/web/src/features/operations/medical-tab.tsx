'use client';
// Медицинский допуск (API.md, 5.7; G-05, часть 1): только медицинский персонал турнира. Хранится факт допуска,
// срок и кто выдал — без диагнозов; просмотр списка пишется в журнал доступа.
import { type Competition, MEDICAL_STATES, type MedicalRow, type Page, todayIn } from '@sde/contracts';
import { Alert, Badge, Button, EmptyState, Field, Input, Select } from '@sde/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import { athleteName } from './shared';

const STATE_TONE = { VALID: 'success', REVOKED: 'danger', MISSING: 'warning' } as const;

function RecordForm({
  competition: c,
  row,
  onDone,
}: {
  competition: Competition;
  row: MedicalRow;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations('medical');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ validUntil: c.endDate, issuedBy: '', competitionOnly: false });
  const action = useAction();
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('record')}
      </Button>
    );
  return (
    <form
      className="w-full space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      aria-label={t('recordTitle', { name: row.athlete.publicName })}
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          await api(`/competitions/${c.id}/medical-clearances`, {
            method: 'POST',
            body: { athleteId: row.athlete.id, ...form },
          });
          setOpen(false);
          await onDone();
        });
      }}
    >
      <p className="font-medium">{t('recordTitle', { name: row.athlete.publicName })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`mc-until-${row.athlete.id}`} label={t('validUntil')}>
          <Input
            id={`mc-until-${row.athlete.id}`}
            type="date"
            required
            min={todayIn(c.timezone)}
            value={form.validUntil}
            onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
          />
        </Field>
        <Field id={`mc-by-${row.athlete.id}`} label={t('issuedBy')}>
          <Input
            id={`mc-by-${row.athlete.id}`}
            required
            minLength={2}
            maxLength={200}
            value={form.issuedBy}
            onChange={(e) => setForm({ ...form, issuedBy: e.target.value })}
          />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.competitionOnly}
          onChange={(e) => setForm({ ...form, competitionOnly: e.target.checked })}
        />
        {t('competitionOnly')}
      </label>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={action.busy}>
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function MedicalTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('medical');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const params = { state: state || undefined, q: q.trim() || undefined };
  const list = useInfiniteQuery({
    queryKey: ['competitions', c.id, 'medical', params],
    queryFn: ({ pageParam }) =>
      api<Page<MedicalRow>>(`/competitions/${c.id}/medical`, {
        query: { ...params, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  const canRecord = c.allowedActions.includes('medical.record');
  return (
    <div className="space-y-4">
      <Alert tone="info">{t('notice')}</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="med-q" label={t('search')}>
          <Input id="med-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </Field>
        <Field id="med-state" label={t('state')}>
          <Select id="med-state" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{t('allStates')}</option>
            {MEDICAL_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`states.${s}`)}
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
                <li key={r.athlete.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{athleteName(r.athlete)}</p>
                    <span className="text-xs text-slate-600">
                      {r.athlete.birthDate.slice(0, 4)} ·{' '}
                      {r.organizations.map((o) => o.shortName || o.name).join(', ')}
                    </span>
                    <Badge tone={STATE_TONE[r.state]}>{t(`states.${r.state}`)}</Badge>
                  </div>
                  {r.clearance ? (
                    <p className="text-sm text-slate-600">
                      {t('validUntil')}: {formatDate(r.clearance.validUntil, locale)} · {t('issuedBy')}:{' '}
                      {r.clearance.issuedBy}
                      {r.clearance.competitionId ? ` · ${t('forCompetition')}` : ''}
                      {r.clearance.revokeReason
                        ? ` · ${t('revokedBecause', { reason: r.clearance.revokeReason })}`
                        : ''}
                    </p>
                  ) : null}
                  {canRecord ? (
                    <div className="flex flex-wrap gap-2">
                      {r.state !== 'VALID' ? <RecordForm competition={c} row={r} onDone={refresh} /> : null}
                      {r.state === 'VALID' && r.clearance ? (
                        <ReasonAction
                          size="sm"
                          variant="danger"
                          label={t('revoke')}
                          title={t('revokeTitle', { name: r.athlete.publicName })}
                          onConfirm={async (reason) => {
                            await api(`/competitions/${c.id}/medical-clearances/${r.clearance?.id}/revoke`, {
                              method: 'POST',
                              body: { reason },
                            });
                            await refresh();
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
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
