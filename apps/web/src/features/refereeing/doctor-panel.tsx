'use client';
// Врач на ковре (план Phase 7b, §3; G-05, часть 2): помощь (схватка продолжается) или остановка; снятие врачом —
// с подтверждением последствий: победа соперника «травма» (ждёт подтверждения), спортсмен снят с категории, его
// оставшиеся схватки — неявка. Без диагнозов; заметку видит только медицинский персонал.
import {
  formatMatchClock,
  type MatchDetailDto,
  type MedicalIncidentDecision,
  type MedicalIncidentDto,
  type MedicalIncidentKind,
  type Side,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, cn, Field, Textarea } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { recordIncident } from '@/features/results/api';
import { useRefereeLabels } from './labels';
import { useDescribe } from './tablet-parts';

const choice = (active: boolean): string =>
  cn(
    'min-h-12 rounded-lg border-2 px-3 text-left font-semibold',
    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white',
  );

export function DoctorPanel({
  match,
  onDone,
}: {
  match: MatchDetailDto;
  onDone: (m: MatchDetailDto) => void;
}) {
  const t = useTranslations('referee.doctor');
  const label = useRefereeLabels();
  const describe = useDescribe();
  const [side, setSide] = useState<Side | null>(null);
  const [kind, setKind] = useState<MedicalIncidentKind>('ASSISTANCE');
  const [decision, setDecision] = useState<MedicalIncidentDecision>('CONTINUE');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = kind === 'STOPPAGE' && decision === 'WITHDRAWN_BY_DOCTOR';
  const who = (s: Side): string =>
    `${label.side(s)} — ${(s === 'RED' ? match.red : match.blue).publicName ?? ''}`;

  const submit = async (): Promise<void> => {
    if (!side) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordIncident(match.id, {
        side,
        kind,
        decision: kind === 'STOPPAGE' ? decision : 'CONTINUE',
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSide(null);
      setKind('ASSISTANCE');
      setDecision('CONTINUE');
      setNote('');
      setConfirming(false);
      onDone(res.data);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-2 border-emerald-600">
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">{t('who')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['RED', 'BLUE'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s}
                onClick={() => {
                  setSide(s);
                  setConfirming(false);
                }}
                className={cn(
                  'min-h-12 rounded-lg border-2 px-3 text-left font-semibold',
                  s === 'RED' ? 'border-red-600' : 'border-blue-600',
                  side === s
                    ? s === 'RED'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                    : 'bg-white',
                )}
              >
                {side === s ? '✓ ' : ''}
                {who(s)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">{t('kind')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['ASSISTANCE', 'STOPPAGE'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setConfirming(false);
                  if (k === 'ASSISTANCE') setDecision('CONTINUE');
                }}
                className={choice(kind === k)}
              >
                {kind === k ? '✓ ' : ''}
                {t(`kinds.${k}`)}
                <span className="block text-sm font-normal opacity-80">{t(`kindHints.${k}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {kind === 'STOPPAGE' ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">{t('decision')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['CONTINUE', 'WITHDRAWN_BY_DOCTOR'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={decision === d}
                  onClick={() => {
                    setDecision(d);
                    setConfirming(false);
                  }}
                  className={choice(decision === d)}
                >
                  {decision === d ? '✓ ' : ''}
                  {t(`decisions.${d}`)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field id="doctor-note" label={t('note')} hint={t('noteHint')}>
          <Textarea
            id="doctor-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </Field>
        {confirming && side ? (
          <Alert tone="warning" title={t('withdrawTitle', { who: who(side) })}>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('stopFirst')}</li>
              <li>{t('withdrawResult')}</li>
              <li>{t('withdrawEntry')}</li>
              <li>{t('withdrawNext')}</li>
            </ul>
          </Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {withdraw && !confirming ? (
            <Button size="lg" variant="danger" disabled={!side} onClick={() => setConfirming(true)}>
              {t('withdraw')}
            </Button>
          ) : (
            <Button
              size="lg"
              variant={withdraw ? 'danger' : 'primary'}
              disabled={!side}
              loading={busy}
              onClick={() => void submit()}
            >
              {withdraw ? t('withdrawConfirm') : t('record')}
            </Button>
          )}
          {confirming ? (
            <Button size="lg" variant="secondary" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** Записи врача по схватке: время, угол, вид, решение; заметка — только медицинскому персоналу. */
export function IncidentList({ incidents }: { incidents: MedicalIncidentDto[] }) {
  const t = useTranslations('referee.doctor');
  const label = useRefereeLabels();
  const locale = useLocale();
  if (incidents.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {incidents.map((i) => (
        <li key={i.id} className="py-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono">
              {i.matchClockMs !== null ? formatMatchClock(i.matchClockMs) : '—'}
            </span>
            <span>{label.side(i.side)}</span>
            <Badge tone={i.decision === 'WITHDRAWN_BY_DOCTOR' ? 'danger' : 'info'}>
              {t(`kinds.${i.kind}`)} · {t(`decisions.${i.decision}`)}
            </Badge>
            <span className="text-slate-500">
              {i.recordedBy?.displayName ?? '—'}, {formatDateTime(i.recordedAt, locale)}
            </span>
          </p>
          {i.note ? (
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{`${t('note')}: ${i.note}`}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
