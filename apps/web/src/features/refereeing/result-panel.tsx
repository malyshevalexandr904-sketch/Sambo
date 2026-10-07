'use client';
// Результат схватки на планшете (план Phase 7a, §3, §5): предложенный сервером исход и двухшаговое подтверждение —
// итоговый счёт и способ, затем «Подтвердить». Исход, отличный от предложенного, — с причиной (решение судей).
import {
  type DataEnvelope,
  determineOutcome,
  type MatchDetailDto,
  type MatchState,
  RESULT_METHODS,
  type ResultMethod,
  type ScoringRules,
  type Side,
} from '@sde/contracts';
import { Alert, Button, cn, Field, Textarea } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { useRefereeLabels } from './labels';

export function ResultPanel({
  match,
  state,
  rules,
  serverSeq,
  onDone,
  onCancel,
}: {
  match: MatchDetailDto;
  state: MatchState;
  rules: ScoringRules;
  serverSeq: number;
  onDone: (m: MatchDetailDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const proposal = determineOutcome(state, rules);
  const [winner, setWinner] = useState<Side | null>(proposal?.winnerSide ?? null);
  const [method, setMethod] = useState<ResultMethod | null>(
    proposal && RESULT_METHODS.includes(proposal.method as ResultMethod)
      ? (proposal.method as ResultMethod)
      : null,
  );
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const action = useAction();
  const agrees =
    !!proposal &&
    (proposal.winnerSide === null
      ? method === 'DECISION'
      : proposal.winnerSide === winner && proposal.method === method);
  const reasonOk = agrees || reason.trim().length >= 5;
  const ready = winner !== null && method !== null && reasonOk;

  const submit = async (): Promise<void> => {
    const res = await action.run(() =>
      api<DataEnvelope<MatchDetailDto>>(`/matches/${match.id}/result`, {
        method: 'POST',
        version: match.version,
        body: {
          expectedSeq: serverSeq,
          winnerSide: winner,
          method,
          ...(agrees ? {} : { reason: reason.trim() }),
        },
      }),
    );
    if (res) onDone(res.data);
  };

  const sideName = (s: Side): string =>
    `${label.side(s)} — ${(s === 'RED' ? match.red : match.blue).publicName ?? ''}`;

  return (
    <section aria-labelledby="result-title" className="rounded-xl border-2 border-slate-900 bg-white p-4">
      <h2 id="result-title" className="text-lg font-semibold">
        {step === 1 ? t('resultStep1') : t('resultStep2')}
      </h2>
      <p className="mt-2 text-base">
        <span className="font-medium">{t('proposed')}: </span>
        {proposal ? label.proposal(proposal) : t('proposedNone')}
      </p>
      <p className="font-mono text-2xl font-bold tabular-nums">
        {state.red.points}:{state.blue.points}
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
              {RESULT_METHODS.map((m) => (
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
          {!agrees ? (
            <Field id="result-reason" label={t('reason')} hint={t('reasonHint')}>
              <Textarea
                id="result-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </Field>
          ) : null}
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
          <Alert tone="info">
            {winner && method
              ? t('summary', {
                  winner: sideName(winner),
                  method: label.method(method),
                  red: state.red.points,
                  blue: state.blue.points,
                })
              : null}
            {!agrees && reason ? <p className="mt-1">{`${t('reason')}: ${reason}`}</p> : null}
          </Alert>
          {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" loading={action.busy} onClick={() => void submit()}>
              {t('recordResult')}
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
