'use client';
// Части планшета ковра (план Phase 7a, §5): индикатор связи, заголовок схватки, вызов и неявка до старта,
// записанный результат с подтверждением, следующая схватка и результаты, ждущие подтверждения.
import type { MatchDetailDto, MatConsoleDto } from '@sde/contracts';
import { Alert, Badge, Button, cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { pickName } from '@/lib/queries';
import { timeInZone, useRoundLabel } from '@/features/scheduling/shared';
import { confirmResult, markNoShow, transitionMatch } from './api';
import { toScoringRules, useRefereeLabels } from './labels';
import { ResultPanel } from './result-panel';

export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** Текст ошибки команды: по коду и с подробностями (невыполненные условия, причина отказа правил). */
export function useDescribe(): (e: unknown) => string {
  const errorMessage = useErrorMessage();
  const label = useRefereeLabels();
  return useCallback(
    (e: unknown) => {
      const base = errorMessage(e);
      if (!(e instanceof ApiError)) return base;
      if (e.code === 'TRANSITION_PRECONDITIONS_NOT_MET')
        return `${base} ${label.precondition(e.details?.failed)}`;
      if (e.code === 'EVENT_NOT_ALLOWED_BY_RULESET') return `${base} ${label.rejection(e.details?.reason)}`;
      return base;
    },
    [errorMessage, label],
  );
}

export function ConnectionBadge({
  offline,
  pending,
  sending,
}: {
  offline: boolean;
  pending: number;
  sending: boolean;
}) {
  const t = useTranslations('referee');
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <Badge tone={offline ? 'danger' : 'success'} className="px-3 py-1 text-sm">
        <span aria-hidden="true">{offline ? '■' : '●'}</span> {offline ? t('offline') : t('online')}
      </Badge>
      <Badge tone={pending > 0 ? 'warning' : 'neutral'} className="px-3 py-1 text-sm">
        <span aria-hidden="true">{pending > 0 ? '◐' : '○'}</span>{' '}
        {pending > 0 ? t('pending', { count: pending }) : sending ? '…' : t('allSent')}
      </Badge>
    </div>
  );
}

export function MatchTitle({ match, timezone }: { match: MatchDetailDto; timezone: string }) {
  const t = useTranslations('referee');
  const locale = useLocale();
  const round = useRoundLabel();
  const awaiting = match.status === 'FINISHED' && match.result?.status === 'PROVISIONAL';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-xl font-semibold">
        {match.number !== null ? t('match', { number: match.number }) : '—'} ·{' '}
        {pickName(match.categoryName, locale)} · {round(match.roundLabel)}
      </h2>
      <Badge
        tone={match.status === 'IN_PROGRESS' ? 'success' : match.status === 'PAUSED' ? 'warning' : 'info'}
      >
        {awaiting ? t('awaitingConfirmation') : t(`matchStatuses.${match.status}`)}
      </Badge>
      {match.plannedAt ? (
        <span className="text-sm text-slate-500">{timeInZone(match.plannedAt, timezone, locale)}</span>
      ) : null}
    </div>
  );
}

/** До старта: пара, вызов и его отмена, старт, неявка. */
export function Prestart({
  match,
  run,
}: {
  match: MatchDetailDto;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const [noShow, setNoShow] = useState(false);
  const can = (a: string): boolean => match.allowedActions.includes(a as never);
  const known = match.red.entryId !== null && match.blue.entryId !== null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {(['RED', 'BLUE'] as const).map((s) => {
          const info = s === 'RED' ? match.red : match.blue;
          return (
            <div
              key={s}
              className={cn(
                'rounded-xl border-l-8 p-4',
                s === 'RED' ? 'border-red-600 bg-red-50' : 'border-blue-600 bg-blue-50',
              )}
            >
              <p className="text-sm font-semibold uppercase text-slate-600">{label.side(s)}</p>
              <p className="text-3xl font-bold">
                {info.publicName ?? (info.bye ? '—' : t('waitingParticipants'))}
              </p>
              <p className="text-slate-600">
                {info.club ?? ''}
                {info.withdrawn ? (
                  <Badge tone="warning" className="ml-2">
                    {t('withdrawn')}
                  </Badge>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
      {!known ? <Alert tone="info">{t('waitingParticipants')}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {can('transition:READY') ? (
          <Button size="lg" onClick={() => void run(() => transitionMatch(match, 'READY'))}>
            {t('call')}
          </Button>
        ) : null}
        {can('transition:IN_PROGRESS') ? (
          <Button
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void run(() => transitionMatch(match, 'IN_PROGRESS'))}
          >
            {t('start')}
          </Button>
        ) : null}
        {can('transition:SCHEDULED') ? (
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void run(() => transitionMatch(match, 'SCHEDULED'))}
          >
            {t('cancelCall')}
          </Button>
        ) : null}
        {can('no_show') ? (
          <Button size="lg" variant="secondary" onClick={() => setNoShow((v) => !v)} aria-expanded={noShow}>
            {t('noShow')}
          </Button>
        ) : null}
      </div>
      {noShow ? (
        <div
          className="rounded-xl border border-slate-300 bg-white p-4"
          role="group"
          aria-label={t('noShowTitle')}
        >
          <p className="mb-2 font-medium">{t('noShowTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {(['RED', 'BLUE', 'BOTH'] as const).map((side) => (
              <Button
                key={side}
                size="lg"
                variant="danger"
                onClick={() => void run(() => markNoShow(match, side))}
              >
                {side === 'BOTH' ? t('noShowBoth') : t('noShowSide', { side: label.side(side) })}
              </Button>
            ))}
            <Button size="lg" variant="secondary" onClick={() => setNoShow(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Результат записан: итог и — для руководителя ковра — подтверждение вторым шагом на том же экране; до
 * подтверждения бригада может исправить результат. */
export function RecordedPanel({
  match,
  onUpdated,
  onClose,
}: {
  match: MatchDetailDto;
  onUpdated: (m: MatchDetailDto) => void;
  onClose: () => void;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const describe = useDescribe();
  const rules = useMemo(() => toScoringRules(match.rules), [match.rules]);
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = match.result;
  if (correcting && match.state) {
    return (
      <ResultPanel
        match={match}
        state={match.state}
        rules={rules}
        serverSeq={match.seq}
        onDone={(m) => {
          setCorrecting(false);
          onUpdated(m);
        }}
        onCancel={() => setCorrecting(false)}
      />
    );
  }
  if (!r) return null;
  const confirmable = match.allowedActions.includes('result.confirm');
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await confirmResult(match);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-4"
      aria-live="polite"
    >
      <p className="text-lg font-semibold">
        {r.winnerSide
          ? t('summary', {
              winner: `${label.side(r.winnerSide)} — ${(r.winnerSide === 'RED' ? match.red : match.blue).publicName ?? ''}`,
              method: label.method(r.method, r.methodDetail),
              red: r.redScore ?? 0,
              blue: r.blueScore ?? 0,
            })
          : t('summaryBoth', { method: label.method(r.method) })}
      </p>
      <p>{confirmable ? t('confirmAsChief') : t('recorded')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {confirmable ? (
          <Button size="lg" loading={busy} onClick={() => void confirm()}>
            {t('confirmResult')}
          </Button>
        ) : null}
        {match.allowedActions.includes('result.record') ? (
          <Button size="lg" variant="secondary" onClick={() => setCorrecting(true)}>
            {t('correct')}
          </Button>
        ) : null}
        <Button size="lg" variant="secondary" className="ml-auto" onClick={onClose}>
          {t('toNextMatch')}
        </Button>
      </div>
    </section>
  );
}

export function NextAndAwaiting({
  data,
  onChanged,
  hide,
}: {
  data: MatConsoleDto;
  onChanged: () => void;
  /** Схватка, чей результат уже показан выше (записан с этого планшета): следующая тогда — текущая в очереди. */
  hide?: string;
}) {
  const t = useTranslations('referee');
  const locale = useLocale();
  const round = useRoundLabel();
  const label = useRefereeLabels();
  const describe = useDescribe();
  const [error, setError] = useState<string | null>(null);
  const awaiting = data.awaitingConfirmation.filter((m) => m.id !== hide);
  const next = hide && data.current && data.current.id !== hide ? data.current : data.next;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('nextMatch')}
        </h2>
        {next ? (
          <p className="text-lg">
            <span className="font-semibold">
              {next.number !== null ? t('match', { number: next.number }) : ''} {round(next.roundLabel)}
            </span>{' '}
            · {pickName(next.categoryName, locale)}
            <br />
            <span className="text-red-800">{next.red.publicName ?? t('waitingParticipants')}</span>
            {' — '}
            <span className="text-blue-800">{next.blue.publicName ?? t('waitingParticipants')}</span>
            {next.plannedAt ? (
              <span className="ml-2 text-sm text-slate-500">
                {timeInZone(next.plannedAt, data.competition.timezone, locale)}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-slate-500">{t('noNextMatch')}</p>
        )}
      </section>
      {awaiting.length > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-900">
            {t('awaitingCount', { count: awaiting.length })}
          </h2>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ul className="space-y-2">
            {awaiting.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {m.number !== null ? t('match', { number: m.number }) : ''} · {m.red.publicName} —{' '}
                  {m.blue.publicName}
                  {m.result ? (
                    <span className="ml-1 text-sm text-slate-600">
                      ({label.method(m.result.method)}, {m.result.redScore ?? 0}:{m.result.blueScore ?? 0})
                    </span>
                  ) : null}
                </span>
                {m.canConfirm ? (
                  <Button
                    size="lg"
                    onClick={async () => {
                      setError(null);
                      try {
                        await confirmResult(m);
                        onChanged();
                      } catch (e) {
                        setError(describe(e));
                      }
                    }}
                  >
                    {t('confirm')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
