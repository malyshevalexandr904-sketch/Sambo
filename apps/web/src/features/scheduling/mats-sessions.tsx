'use client';
// Ковры и сессии турнирного дня (план Phase 6, §1): список + добавление; правка номера/названия/активности
// ковра и времени сессии — точечно на строке. Право — mat.manage (ковры), schedule.manage (сессии).
import { type Competition, localDateTimeIn, type MatDto, type ScheduleSessionDto, zonedToInstant } from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useAction } from '@/lib/use-action';
import { useInvalidateScheduling, useMats, useSessions } from './shared';

function AddMatForm({ competitionId, onDone }: { competitionId: string; onDone: () => Promise<void> }) {
  const t = useTranslations('scheduling.mats');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const action = useAction();
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          await api(`/competitions/${competitionId}/mats`, {
            method: 'POST',
            body: { number: Number(number), name: name.trim() || undefined, isActive: true },
          });
          setNumber('');
          setName('');
          await onDone();
        });
      }}
    >
      <Field id="mat-number" label={t('number')}>
        <Input
          id="mat-number"
          type="number"
          min={1}
          max={200}
          required
          className="w-24"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </Field>
      <Field id="mat-name" label={t('name')}>
        <Input id="mat-name" className="w-40" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" loading={action.busy}>
        {t('add')}
      </Button>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
    </form>
  );
}

function MatRow({ mat, canManage, onDone }: { mat: MatDto; canManage: boolean; onDone: () => Promise<void> }) {
  const t = useTranslations('scheduling.mats');
  const action = useAction();
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="font-medium">№{mat.number}</span>
      <span className="flex-1 truncate text-slate-600">{mat.name ?? '—'}</span>
      <Badge tone={mat.isActive ? 'success' : 'neutral'}>{mat.isActive ? t('active') : t('inactive')}</Badge>
      {canManage ? (
        <Button
          size="sm"
          variant="ghost"
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/competitions/${mat.competitionId}/mats/${mat.id}`, {
                method: 'PATCH',
                version: mat.version,
                body: { isActive: !mat.isActive },
              });
              await onDone();
            })
          }
        >
          {mat.isActive ? t('deactivate') : t('activate')}
        </Button>
      ) : null}
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
    </li>
  );
}

function MatsCard({ competition, canManage }: { competition: Competition; canManage: boolean }) {
  const t = useTranslations('scheduling.mats');
  const query = useMats(competition.id);
  const invalidate = useInvalidateScheduling(competition.id);
  const errorMessage = useErrorMessage();
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      {query.error ? <Alert tone="danger">{errorMessage(query.error)}</Alert> : null}
      <ul className="divide-y divide-slate-100">
        {(query.data ?? []).map((m) => (
          <MatRow key={m.id} mat={m} canManage={canManage} onDone={invalidate} />
        ))}
      </ul>
      {query.data?.length === 0 ? <p className="text-sm text-slate-500">{t('none')}</p> : null}
      {canManage ? <AddMatForm competitionId={competition.id} onDone={invalidate} /> : null}
    </Card>
  );
}

function AddSessionForm({ competition, onDone }: { competition: Competition; onDone: () => Promise<void> }) {
  const t = useTranslations('scheduling.sessions');
  const day = competition.startDate;
  const [form, setForm] = useState({ name: '', starts: `${day}T09:00`, ends: `${day}T18:00` });
  const action = useAction();
  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          await api(`/competitions/${competition.id}/sessions`, {
            method: 'POST',
            body: {
              name: form.name,
              startsAt: zonedToInstant(form.starts, competition.timezone),
              endsAt: zonedToInstant(form.ends, competition.timezone),
            },
          });
          setForm({ name: '', starts: `${day}T09:00`, ends: `${day}T18:00` });
          await onDone();
        });
      }}
    >
      <Field id="session-name" label={t('name')}>
        <Input
          id="session-name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field id="session-start" label={t('startsAt')} hint={competition.timezone}>
        <Input
          id="session-start"
          type="datetime-local"
          required
          value={form.starts}
          onChange={(e) => setForm({ ...form, starts: e.target.value })}
        />
      </Field>
      <Field id="session-end" label={t('endsAt')} hint={competition.timezone}>
        <Input
          id="session-end"
          type="datetime-local"
          required
          value={form.ends}
          onChange={(e) => setForm({ ...form, ends: e.target.value })}
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={action.busy}>
          {t('add')}
        </Button>
      </div>
      {action.error ? (
        <Alert tone="danger" className="sm:col-span-4">
          {action.error}
        </Alert>
      ) : null}
    </form>
  );
}

function SessionRow({
  session,
  timezone,
  canManage,
  onDone,
}: {
  session: ScheduleSessionDto;
  timezone: string;
  canManage: boolean;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('scheduling.sessions');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: session.name,
    starts: localDateTimeIn(session.startsAt, timezone),
    ends: localDateTimeIn(session.endsAt, timezone),
  });
  const action = useAction();
  if (editing) {
    return (
      <li className="py-2">
        <form
          className="grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api(`/competitions/${session.competitionId}/sessions/${session.id}`, {
                method: 'PATCH',
                version: session.version,
                body: {
                  name: form.name,
                  startsAt: zonedToInstant(form.starts, timezone),
                  endsAt: zonedToInstant(form.ends, timezone),
                },
              });
              setEditing(false);
              await onDone();
            });
          }}
        >
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input
            type="datetime-local"
            value={form.starts}
            onChange={(e) => setForm({ ...form, starts: e.target.value })}
            required
          />
          <Input
            type="datetime-local"
            value={form.ends}
            onChange={(e) => setForm({ ...form, ends: e.target.value })}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={action.busy}>
              {t('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
          {action.error ? (
            <Alert tone="danger" className="sm:col-span-4">
              {action.error}
            </Alert>
          ) : null}
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="font-medium">{session.name}</span>
      <span className="flex-1 text-slate-600">
        {localDateTimeIn(session.startsAt, timezone).replace('T', ' ')} –{' '}
        {localDateTimeIn(session.endsAt, timezone).slice(11)}
      </span>
      {canManage ? (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
      ) : null}
    </li>
  );
}

function SessionsCard({ competition, canManage }: { competition: Competition; canManage: boolean }) {
  const t = useTranslations('scheduling.sessions');
  const query = useSessions(competition.id);
  const invalidate = useInvalidateScheduling(competition.id);
  const errorMessage = useErrorMessage();
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      {query.error ? <Alert tone="danger">{errorMessage(query.error)}</Alert> : null}
      <ul className="divide-y divide-slate-100">
        {(query.data ?? []).map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            timezone={competition.timezone}
            canManage={canManage}
            onDone={invalidate}
          />
        ))}
      </ul>
      {query.data?.length === 0 ? <p className="text-sm text-slate-500">{t('none')}</p> : null}
      {canManage ? <AddSessionForm competition={competition} onDone={invalidate} /> : null}
    </Card>
  );
}

export function MatsSessionsPanel({ competition }: { competition: Competition }) {
  const can = (a: string): boolean => competition.allowedActions.includes(a);
  return (
    <div className="grid gap-4 print:hidden sm:grid-cols-2">
      <MatsCard competition={competition} canManage={can('mat.manage')} />
      <SessionsCard competition={competition} canManage={can('schedule.manage')} />
    </div>
  );
}
