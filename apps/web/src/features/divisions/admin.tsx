'use client';
// Дивизионы спортсменов по возрасту (docs/RATED_ONLY.md, 4): администратор платформы задаёт их число и границы.
// Границы включительно, пустая — без ограничения; дивизионы не пересекаются — это проверяет сервер.
import {
  DIVISION_AGE_POLICIES,
  type DataEnvelope,
  type DivisionAgePolicy,
  type DivisionDto,
  type DivisionList,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { useAction } from '@/lib/use-action';
import { ageRange } from './shared';

export const DIVISIONS_KEY = ['divisions'] as const;

export function useDivisions() {
  return useQuery({
    queryKey: DIVISIONS_KEY,
    queryFn: async () => (await api<DataEnvelope<DivisionList>>('/divisions')).data,
    staleTime: 60_000,
  });
}

export function DivisionsAdmin() {
  const t = useTranslations('divisions');
  const query = useDivisions();
  return (
    <>
      <PageHeader title={t('title')} description={t('hint')} />
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          query.data ? (
            <div className="grid max-w-3xl gap-6">
              <PolicyCard policy={query.data.agePolicy} />
              <Card>
                <CardTitle>{t('listTitle')}</CardTitle>
                {query.data.divisions.length === 0 ? (
                  <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {query.data.divisions.map((d) => (
                      <DivisionRow key={d.id} division={d} />
                    ))}
                  </ul>
                )}
              </Card>
              <DivisionForm />
            </div>
          ) : null
        }
      </QueryState>
    </>
  );
}

function PolicyCard({ policy }: { policy: DivisionAgePolicy }) {
  const t = useTranslations('divisions');
  const queryClient = useQueryClient();
  const action = useAction();
  return (
    <Card>
      <CardTitle>{t('policyTitle')}</CardTitle>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <Field id="d-policy" label={t('policy')} hint={t(`policyHints.${policy}`)}>
        <Select
          id="d-policy"
          value={policy}
          disabled={action.busy}
          onChange={(e) =>
            void action.run(async () => {
              const res = await api<DataEnvelope<DivisionList>>('/admin/divisions/age-policy', {
                method: 'PUT',
                body: { agePolicy: e.target.value },
              });
              queryClient.setQueryData(DIVISIONS_KEY, res.data);
            })
          }
        >
          {DIVISION_AGE_POLICIES.map((p) => (
            <option key={p} value={p}>
              {t(`policies.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
    </Card>
  );
}

interface Values {
  name: string;
  minAge: string;
  maxAge: string;
  description: string;
}

const toAge = (v: string): number | null => (v.trim() === '' ? null : Number(v));

/** Поля дивизиона и отправка: новое — POST, изменение — PATCH с версией. */
function useDivisionEditor(initial: Values, save: (body: object) => Promise<void>) {
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const submit = (): Promise<unknown> =>
    action.run(async () => {
      setErrors({});
      try {
        await save({
          name: v.name.trim(),
          minAge: toAge(v.minAge),
          maxAge: toAge(v.maxAge),
          description: v.description.trim() || null,
        });
      } catch (e) {
        if (e instanceof ApiError && e.fields.length > 0) {
          setErrors(Object.fromEntries(e.fields.map((f) => [f.path, f.code])));
          return;
        }
        throw e;
      }
    });
  return { v, setV, errors, action, submit };
}

function DivisionFields({
  prefix,
  v,
  setV,
  errors,
}: {
  prefix: string;
  v: Values;
  setV: (fn: (x: Values) => Values) => void;
  errors: Record<string, string>;
}) {
  const t = useTranslations('divisions');
  const tf = useFieldMessage();
  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id={`${prefix}-name`} label={t('name')} error={tf(errors.name)} className="sm:col-span-3">
        <Input id={`${prefix}-name`} value={v.name} onChange={set('name')} maxLength={80} required />
      </Field>
      <Field id={`${prefix}-min`} label={t('minAge')} hint={t('openHint')} error={tf(errors.minAge)}>
        <Input
          id={`${prefix}-min`}
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          value={v.minAge}
          onChange={set('minAge')}
        />
      </Field>
      <Field id={`${prefix}-max`} label={t('maxAge')} hint={t('openHint')} error={tf(errors.maxAge)}>
        <Input
          id={`${prefix}-max`}
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          value={v.maxAge}
          onChange={set('maxAge')}
        />
      </Field>
      <Field
        id={`${prefix}-desc`}
        label={t('description')}
        error={tf(errors.description)}
        className="sm:col-span-3"
      >
        <Input id={`${prefix}-desc`} value={v.description} onChange={set('description')} maxLength={500} />
      </Field>
    </div>
  );
}

function DivisionForm() {
  const t = useTranslations('divisions');
  const queryClient = useQueryClient();
  const empty: Values = { name: '', minAge: '', maxAge: '', description: '' };
  const editor = useDivisionEditor(empty, async (body) => {
    await api('/admin/divisions', { method: 'POST', body });
    editor.setV(() => empty);
    await queryClient.invalidateQueries({ queryKey: DIVISIONS_KEY });
  });
  return (
    <Card>
      <CardTitle>{t('addTitle')}</CardTitle>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void editor.submit();
        }}
      >
        {editor.action.error ? (
          <Alert tone="danger" className="mb-3">
            {editor.action.error}
          </Alert>
        ) : null}
        <DivisionFields prefix="d-new" v={editor.v} setV={editor.setV} errors={editor.errors} />
        <Button type="submit" className="mt-4" loading={editor.action.busy} disabled={!editor.v.name.trim()}>
          {t('add')}
        </Button>
      </form>
    </Card>
  );
}

function DivisionRow({ division: d }: { division: DivisionDto }) {
  const t = useTranslations('divisions');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useAction();
  const editor = useDivisionEditor(
    {
      name: d.name,
      minAge: d.minAge?.toString() ?? '',
      maxAge: d.maxAge?.toString() ?? '',
      description: d.description ?? '',
    },
    async (body) => {
      await api(`/admin/divisions/${d.id}`, { method: 'PATCH', body, version: d.version });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: DIVISIONS_KEY });
    },
  );
  if (editing)
    return (
      <li className="py-4">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void editor.submit();
          }}
        >
          {editor.action.error ? (
            <Alert tone="danger" className="mb-3">
              {editor.action.error}
            </Alert>
          ) : null}
          <DivisionFields prefix={`d-${d.id}`} v={editor.v} setV={editor.setV} errors={editor.errors} />
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm" loading={editor.action.busy}>
              {t('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </li>
    );
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{d.name}</p>
        <p className="text-sm text-slate-600">
          {ageRange(t, d)}
          {d.description ? ` · ${d.description}` : ''}
        </p>
        {remove.error ? <p className="text-sm text-red-700">{remove.error}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={remove.busy}
          onClick={() => {
            if (!window.confirm(t('removeConfirm', { name: d.name }))) return;
            void remove.run(async () => {
              await api(`/admin/divisions/${d.id}`, { method: 'DELETE' });
              await queryClient.invalidateQueries({ queryKey: DIVISIONS_KEY });
            });
          }}
        >
          {t('remove')}
        </Button>
      </div>
    </li>
  );
}
