'use client';
// Ручная правка одной схватки (план Phase 6, §3): пакет из одного хода. Запреты — отказ, предупреждения —
// подтверждение confirm: true (вынесено из schedule-tab.tsx, чтобы уложиться в лимит строк файла).
import type { MatDto, ScheduleDto, ScheduleMatchDto, ScheduleSessionDto } from '@sde/contracts';
import { Alert, Button, Field, Select } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { scheduleWarnings } from './shared';

export function MoveMatchForm({
  item,
  schedule,
  competitionId,
  mats,
  sessions,
  onDone,
  onClose,
}: {
  item: ScheduleMatchDto;
  schedule: ScheduleDto;
  competitionId: string;
  mats: MatDto[];
  sessions: ScheduleSessionDto[];
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('scheduling.move');
  const wt = useTranslations('scheduling.warnings');
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState({
    sessionId: item.sessionId,
    matId: item.matId,
    orderInMat: item.orderInMat,
    locked: item.locked,
  });
  const [warnings, setWarnings] = useState<
    { matchId: string; kind: string; shortfallSeconds: number }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (confirm: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/competitions/${competitionId}/schedule/items`, {
        method: 'PATCH',
        version: schedule.version,
        body: {
          moves: [
            {
              matchId: item.matchId,
              sessionId: form.sessionId,
              matId: form.matId,
              orderInMat: form.orderInMat,
              locked: form.locked,
            },
          ],
          confirm,
        },
      });
      onClose();
      await onDone();
    } catch (e) {
      const w = scheduleWarnings(e);
      if (w.length > 0) setWarnings(w);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3"
      role="group"
      aria-label={t('title')}
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <Field id={`move-session-${item.matchId}`} label={t('session')}>
          <Select
            id={`move-session-${item.matchId}`}
            value={form.sessionId}
            onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`move-mat-${item.matchId}`} label={t('mat')}>
          <Select
            id={`move-mat-${item.matchId}`}
            value={form.matId}
            onChange={(e) => setForm({ ...form, matId: e.target.value })}
          >
            {mats.map((m) => (
              <option key={m.id} value={m.id}>
                №{m.number} {m.name ?? ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`move-order-${item.matchId}`} label={t('order')}>
          <input
            id={`move-order-${item.matchId}`}
            type="number"
            min={1}
            max={999}
            className="h-11 w-full rounded-md border border-slate-300 px-3"
            value={form.orderInMat}
            onChange={(e) => setForm({ ...form, orderInMat: Number(e.target.value) })}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={form.locked}
            onChange={(e) => setForm({ ...form, locked: e.target.checked })}
          />
          {t('locked')}
        </label>
      </div>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
      {warnings && warnings.length > 0 ? (
        <Alert tone="warning" className="mt-2">
          <ul className="list-inside list-disc">
            {warnings.map((w, i) => (
              <li key={i}>{wt(w.kind, { seconds: w.shortfallSeconds })}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="mt-3 flex gap-2">
        {warnings && warnings.length > 0 ? (
          <Button variant="danger" loading={busy} onClick={() => void submit(true)}>
            {t('saveAnyway')}
          </Button>
        ) : (
          <Button loading={busy} onClick={() => void submit(false)}>
            {t('save')}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
