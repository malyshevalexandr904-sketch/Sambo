'use client';
// Весы и окна взвешивания (API.md, 5.6): просмотр — `weighin.view`, настройка — `weighin.manage`. Время окна —
// в часовом поясе турнира (ADR-13).
import {
  type Competition,
  type DataEnvelope,
  localDateIn,
  localDateTimeIn,
  type ScaleDto,
  todayIn,
  WEIGH_IN_WINDOW_KINDS,
  type WeighInWindowDto,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCategories } from '@/features/competitions/categories';
import { formatInZone } from '@/features/competitions/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function useScales(competitionId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'scales'],
    queryFn: async () => (await api<DataEnvelope<ScaleDto[]>>(`/competitions/${competitionId}/scales`)).data,
  });
}

export function useWindows(competitionId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'weigh-in-windows'],
    queryFn: async () =>
      (await api<DataEnvelope<WeighInWindowDto[]>>(`/competitions/${competitionId}/weigh-in-windows`)).data,
  });
}

function ScalesCard({ competition: c, manage }: { competition: Competition; manage: boolean }) {
  const t = useTranslations('weighin');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const scales = useScales(c.id);
  const action = useAction();
  const [form, setForm] = useState({ name: '', serialNumber: '', verifiedUntil: '' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id, 'scales'] });
  return (
    <Card>
      <CardTitle>{t('scalesTitle')}</CardTitle>
      {(scales.data ?? []).length === 0 ? <p className="text-sm text-slate-600">{t('noScales')}</p> : null}
      <ul className="space-y-2">
        {(scales.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{s.name}</span>
            {s.serialNumber ? <span className="text-slate-600">№ {s.serialNumber}</span> : null}
            <span className="text-slate-600">
              {t('verifiedUntil')}: {formatDate(s.verifiedUntil, locale)}
            </span>
            {!s.verified ? <Badge tone="danger">{t('scaleExpired')}</Badge> : null}
            {manage ? (
              <Button
                size="sm"
                variant="ghost"
                loading={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api(`/competitions/${c.id}/scales/${s.id}`, { method: 'DELETE' });
                    await refresh();
                  })
                }
              >
                {t('deleteScale')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {action.error ? (
        <Alert tone="danger" className="mt-3">
          {action.error}
        </Alert>
      ) : null}
      {manage ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api(`/competitions/${c.id}/scales`, {
                method: 'POST',
                body: {
                  name: form.name,
                  serialNumber: form.serialNumber || null,
                  verifiedUntil: form.verifiedUntil,
                },
              });
              setForm({ name: '', serialNumber: '', verifiedUntil: '' });
              await refresh();
            });
          }}
        >
          <Field id="scale-name" label={t('scaleName')}>
            <Input
              id="scale-name"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field id="scale-serial" label={t('serial')}>
            <Input
              id="scale-serial"
              maxLength={60}
              value={form.serialNumber}
              onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
            />
          </Field>
          <Field id="scale-until" label={t('verifiedUntil')}>
            <Input
              id="scale-until"
              type="date"
              required
              value={form.verifiedUntil}
              onChange={(e) => setForm({ ...form, verifiedUntil: e.target.value })}
            />
          </Field>
          <Button type="submit" className="self-end" loading={action.busy}>
            {t('addScale')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function WindowForm({
  competition: c,
  onSaved,
}: {
  competition: Competition;
  onSaved: () => Promise<unknown>;
}) {
  const t = useTranslations('weighin');
  const locale = useLocale();
  const categories = useCategories(c.id);
  const active = (categories.data ?? []).filter((x) => x.status !== 'MERGED' && x.status !== 'CANCELLED');
  const day = localDateIn(new Date(), c.timezone) < c.startDate ? c.startDate : todayIn(c.timezone);
  const [form, setForm] = useState({
    name: '',
    starts: `${day}T08:00`,
    ends: `${day}T12:00`,
    kind: 'OFFICIAL',
    categoryIds: [] as string[],
  });
  const action = useAction();
  const toggle = (id: string): void =>
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  return (
    <form
      className="mt-4 space-y-3 border-t border-slate-200 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          await api(`/competitions/${c.id}/weigh-in-windows`, {
            method: 'POST',
            body: {
              name: form.name,
              kind: form.kind,
              startsAt: zonedToInstant(form.starts, c.timezone),
              endsAt: zonedToInstant(form.ends, c.timezone),
              categoryIds: form.categoryIds,
            },
          });
          setForm((f) => ({ ...f, name: '', categoryIds: [] }));
          await onSaved();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="win-name" label={t('windowName')}>
          <Input
            id="win-name"
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field id="win-start" label={t('startsAt')} hint={c.timezone}>
          <Input
            id="win-start"
            type="datetime-local"
            required
            value={form.starts}
            onChange={(e) => setForm({ ...form, starts: e.target.value })}
          />
        </Field>
        <Field id="win-end" label={t('endsAt')} hint={c.timezone}>
          <Input
            id="win-end"
            type="datetime-local"
            required
            value={form.ends}
            onChange={(e) => setForm({ ...form, ends: e.target.value })}
          />
        </Field>
        <Field id="win-kind" label={t('windowKind')}>
          <Select
            id="win-kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {WEIGH_IN_WINDOW_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`windowKinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('windowCategories')}</legend>
        <label className="mb-2 flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={active.length > 0 && form.categoryIds.length === active.length}
            onChange={(e) =>
              setForm({ ...form, categoryIds: e.target.checked ? active.map((x) => x.id) : [] })
            }
          />
          {t('allCategoriesOption')}
        </label>
        <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
          {active.map((cat) => (
            <label key={cat.id} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={form.categoryIds.includes(cat.id)}
                onChange={() => toggle(cat.id)}
              />
              {pickName(cat.name, locale)}
            </label>
          ))}
        </div>
      </fieldset>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <Button type="submit" loading={action.busy} disabled={form.categoryIds.length === 0}>
        {t('addWindow')}
      </Button>
    </form>
  );
}

function WindowsCard({ competition: c, manage }: { competition: Competition; manage: boolean }) {
  const t = useTranslations('weighin');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const windows = useWindows(c.id);
  const action = useAction();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  return (
    <Card>
      <CardTitle>{t('windowsTitle')}</CardTitle>
      {(windows.data ?? []).length === 0 ? <p className="text-sm text-slate-600">{t('noWindows')}</p> : null}
      <ul className="space-y-3">
        {(windows.data ?? []).map((w) => (
          <li key={w.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{w.name}</span>
              <Badge tone="neutral">{t(`windowKinds.${w.kind}`)}</Badge>
              {w.open ? <Badge tone="success">{t('windowOpen')}</Badge> : null}
              <span className="text-slate-600">{t('attemptsCount', { count: w.attempts })}</span>
              {manage && w.attempts === 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`/competitions/${c.id}/weigh-in-windows/${w.id}`, { method: 'DELETE' });
                      await refresh();
                    })
                  }
                >
                  {t('deleteWindow')}
                </Button>
              ) : null}
            </div>
            <p className="text-slate-600">
              {formatInZone(w.startsAt, c.timezone, locale)} —{' '}
              {localDateTimeIn(w.endsAt, c.timezone).slice(11)}
            </p>
            <p className="text-xs text-slate-600">{w.categories.map((x) => x.code).join(', ')}</p>
          </li>
        ))}
      </ul>
      {action.error ? (
        <Alert tone="danger" className="mt-3">
          {action.error}
        </Alert>
      ) : null}
      {manage ? <WindowForm competition={c} onSaved={refresh} /> : null}
    </Card>
  );
}

export function WeighInSetup({ competition: c }: { competition: Competition }) {
  const manage = c.allowedActions.includes('weighin.manage');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ScalesCard competition={c} manage={manage} />
      <WindowsCard competition={c} manage={manage} />
    </div>
  );
}
