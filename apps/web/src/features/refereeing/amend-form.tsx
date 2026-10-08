'use client';
// Изменение подтверждённого результата (план Phase 7b, §2; главный судья): победитель, способ, счёт и причина —
// затем проверка «было → станет» с последствиями. Победитель меняется — сетка пересчитывается; если от результата
// зависят уже начатые схватки — сервер отказывает (DEPENDENT_MATCHES_STARTED) со списком номеров.
import { AMEND_METHODS, type MatchDetailDto, type Side, type WinMethod } from '@sde/contracts';
import { Alert, Button, cn, Field, Input, Textarea } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { amendResult } from '@/features/results/api';
import { useRefereeLabels } from './labels';
import { useDescribe } from './tablet-parts';

type AmendMethod = (typeof AMEND_METHODS)[number];

function useAmendError(): (e: unknown) => string {
  const t = useTranslations('referee.amend');
  const describe = useDescribe();
  return (e) => {
    if (e instanceof ApiError && e.code === 'DEPENDENT_MATCHES_STARTED') {
      const numbers = (e.details?.matchNumbers as (number | null)[] | undefined) ?? [];
      const list = numbers.filter((n): n is number => n !== null).map((n) => `№ ${n}`);
      return list.length > 0 ? t('dependentStarted', { matches: list.join(', ') }) : describe(e);
    }
    return describe(e);
  };
}

const score = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 999 ? n : undefined;
};

export function AmendForm({
  match,
  onDone,
  onCancel,
}: {
  match: MatchDetailDto;
  onDone: (m: MatchDetailDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const describe = useAmendError();
  const r = match.result;
  const [winner, setWinner] = useState<Side>(r?.winnerSide ?? 'RED');
  const [method, setMethod] = useState<AmendMethod>(
    r && (AMEND_METHODS as WinMethod[]).includes(r.method) ? (r.method as AmendMethod) : 'POINTS',
  );
  const [red, setRed] = useState(String(r?.redScore ?? 0));
  const [blue, setBlue] = useState(String(r?.blueScore ?? 0));
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r) return null;
  const sideName = (s: Side): string =>
    `${label.side(s)} — ${(s === 'RED' ? match.red : match.blue).publicName ?? ''}`;
  const redScore = score(red);
  const blueScore = score(blue);
  const changed =
    winner !== r.winnerSide || method !== r.method || redScore !== r.redScore || blueScore !== r.blueScore;
  const ready = changed && reason.trim().length >= 5 && redScore !== undefined && blueScore !== undefined;
  const winnerChanged = winner !== r.winnerSide;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await amendResult(match, {
        winnerSide: winner,
        method,
        ...(method === r.method && r.methodDetail ? { methodDetail: r.methodDetail } : {}),
        redScore,
        blueScore,
        reason: reason.trim(),
      });
      onDone(res.data);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="amend-title" className="rounded-lg border-2 border-amber-500 bg-white p-4">
      <h3 id="amend-title" className="text-lg font-semibold">
        {step === 1 ? t('amend.step1') : t('amend.step2')}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        {t('amend.current', {
          result: r.winnerSide
            ? t('summary', {
                winner: sideName(r.winnerSide),
                method: label.method(r.method, r.methodDetail),
                red: r.redScore ?? 0,
                blue: r.blueScore ?? 0,
              })
            : t('summaryBoth', { method: label.method(r.method) }),
        })}
      </p>
      {step === 1 ? (
        <div className="mt-3 space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">{t('winner')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['RED', 'BLUE'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={winner === s}
                  onClick={() => setWinner(s)}
                  className={cn(
                    'min-h-12 rounded-lg border-2 px-3 text-left font-semibold',
                    s === 'RED' ? 'border-red-600' : 'border-blue-600',
                    winner === s
                      ? s === 'RED'
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                      : 'bg-white',
                  )}
                >
                  {winner === s ? '✓ ' : ''}
                  {sideName(s)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">{t('method')}</legend>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {AMEND_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'min-h-12 rounded-lg border-2 px-2 text-sm font-medium',
                    method === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white',
                  )}
                >
                  {method === m ? '✓ ' : ''}
                  {label.method(m)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <Field id="amend-red" label={t('amend.redScore')}>
              <Input
                id="amend-red"
                inputMode="numeric"
                type="number"
                min={0}
                max={999}
                value={red}
                onChange={(e) => setRed(e.target.value)}
              />
            </Field>
            <Field id="amend-blue" label={t('amend.blueScore')}>
              <Input
                id="amend-blue"
                inputMode="numeric"
                type="number"
                min={0}
                max={999}
                value={blue}
                onChange={(e) => setBlue(e.target.value)}
              />
            </Field>
          </div>
          <Field id="amend-reason" label={t('reason')} hint={t('amend.reasonHint')}>
            <Textarea
              id="amend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </Field>
          {!changed ? <p className="text-sm text-slate-600">{t('amend.unchanged')}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={!ready} onClick={() => setStep(2)}>
              {t('next')}
            </Button>
            <Button size="lg" variant="secondary" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Alert tone="warning" title={t('amend.willBe')}>
            <p>
              {t('summary', {
                winner: sideName(winner),
                method: label.method(method),
                red: redScore ?? 0,
                blue: blueScore ?? 0,
              })}
            </p>
            <p className="mt-1">{`${t('reason')}: ${reason.trim()}`}</p>
          </Alert>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {winnerChanged ? <li>{t('amend.consequenceBracket')}</li> : null}
            <li>{t('amend.consequencePlaces')}</li>
            <li>{t('amend.consequenceRevision')}</li>
          </ul>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="danger" loading={busy} onClick={() => void submit()}>
              {t('amend.submit')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setStep(1)}>
              {t('back')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
