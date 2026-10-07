'use client';
// Планшет ковра (план Phase 7a, §5): текущая схватка во весь экран — вызов пары, старт, время, оценки, удержание,
// наказания, «Отменить последнее», предложенный исход и двухшаговое подтверждение; индикатор связи и
// неотправленных команд; следующая схватка ковра и результаты, ждущие подтверждения (руководитель ковра,
// работающий за планшетом, подтверждает здесь же вторым шагом).
import { clockNowMs, type MatchDetailDto, type MatConsoleDto } from '@sde/contracts';
import { Alert, Badge, Button, EmptyState, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryState } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { timeInZone } from '@/features/scheduling/shared';
import { refereeKeys, transitionMatch, useMatConsole } from './api';
import { actionPoints, toScoringRules, useRefereeLabels } from './labels';
import { ResultPanel } from './result-panel';
import { holdElapsedMs, maxHoldMs, Scoreboard } from './scoreboard';
import {
  ConnectionBadge,
  MatchTitle,
  NextAndAwaiting,
  Prestart,
  RecordedPanel,
  useDescribe,
  useNow,
} from './tablet-parts';
import { useScoring } from './use-scoring';

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Пауза — длинная остановка (врач, экипировка): причина по желанию, не короче 5 знаков. */
function PauseControl({ match, run, disabled }: { match: MatchDetailDto; run: Run; disabled: boolean }) {
  const t = useTranslations('referee');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const text = reason.trim();
  if (!open) {
    return (
      <Button size="lg" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        {t('pause')}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label htmlFor="pause-reason" className="sr-only">
        {t('pauseReason')}
      </label>
      <Input
        id="pause-reason"
        className="min-h-12 w-64"
        placeholder={t('pauseReason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {(['pauseDoctor', 'pauseEquipment'] as const).map((k) => (
        <Button key={k} size="lg" variant="ghost" onClick={() => setReason(t(k))}>
          {t(k)}
        </Button>
      ))}
      <Button
        size="lg"
        disabled={text.length > 0 && text.length < 5}
        onClick={() =>
          void run(async () => {
            await transitionMatch(match, 'PAUSED', text || undefined);
            setOpen(false);
            setReason('');
          })
        }
      >
        {t('pause')}
      </Button>
      <Button size="lg" variant="secondary" onClick={() => setOpen(false)}>
        {t('cancel')}
      </Button>
    </span>
  );
}

function LiveControls({
  match,
  scoring,
  elapsed,
  busy,
  run,
  onFinish,
}: {
  match: MatchDetailDto;
  scoring: ReturnType<typeof useScoring>;
  elapsed: number;
  busy: boolean;
  run: Run;
  onFinish: () => void;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const can = (a: string): boolean => match.allowedActions.includes(a as never);
  const state = scoring.state;
  const target = scoring.undoTarget;
  const points =
    target?.type === 'SCORE' && target.actionCode ? actionPoints(match.rules, target.actionCode) : null;
  const undoWhat = target
    ? [
        t(`eventTypes.${target.type}`),
        target.side ? label.side(target.side) : '',
        `${points ? `+${points} ` : ''}${label.code(target.actionCode)}`.trim(),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const blocked =
    !state || !scoring.loaded || state.clock.running || state.hold !== null || scoring.pendingCount > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
      {can('event.void') ? (
        <Button
          size="lg"
          variant="secondary"
          disabled={!target}
          onClick={() => scoring.undo(elapsed)}
          aria-label={undoWhat ? t('undoWhat', { what: undoWhat }) : t('undo')}
        >
          ↶ {t('undo')}
          {undoWhat ? <span className="text-sm font-normal text-slate-500">({undoWhat})</span> : null}
        </Button>
      ) : null}
      {can('transition:PAUSED') ? <PauseControl match={match} run={run} disabled={busy || blocked} /> : null}
      {match.status === 'PAUSED' && can('transition:IN_PROGRESS') ? (
        <Button
          size="lg"
          disabled={busy}
          onClick={() => void run(() => transitionMatch(match, 'IN_PROGRESS'))}
        >
          {t('resume')}
        </Button>
      ) : null}
      {can('result.record') ? (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {blocked ? <span className="text-sm text-slate-500">{t('finishBlocked')}</span> : null}
          <Button size="lg" variant="danger" disabled={blocked} onClick={onFinish}>
            {t('finish')}
          </Button>
        </span>
      ) : null}
    </div>
  );
}

/** Запас, после которого автоматическое событие шлёт и планшет, не запускавший время (тот мог пропасть). */
const AUTO_GRACE_MS = 3000;

/**
 * Секундомер устройства (R-09): время вышло — «Стоп» на длительности схватки; удержание досчитывается и
 * заканчивается на верхнем пороге правил. Событие шлёт планшет, запустивший время (удержание), остальные — с
 * запасом в 3 с; каждое — один раз на запуск (по номеру события запуска).
 */
function useAutoEvents(
  match: MatchDetailDto,
  scoring: ReturnType<typeof useScoring>,
  now: number,
  active: boolean,
) {
  const { state, log, enqueue, isOwn } = scoring;
  const autoStop = useRef<string | null>(null);
  const autoHold = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !active) return;
    const start = [...log].reverse().find((e) => e.type === 'CLOCK_STARTED');
    if (state.clock.running && start && autoStop.current !== start.id) {
      const raw = state.clock.elapsedMs + (state.clock.at ? now - Date.parse(state.clock.at) : 0);
      if (raw >= state.durationMs + (isOwn(start.id) ? 0 : AUTO_GRACE_MS)) {
        autoStop.current = start.id;
        enqueue({
          type: 'CLOCK_STOPPED',
          side: null,
          actionCode: null,
          value: null,
          matchClockMs: state.durationMs,
        });
      }
    }
    const top = maxHoldMs(match.rules);
    const hold = state.hold;
    if (hold && top > 0 && autoHold.current !== hold.eventId) {
      if (holdElapsedMs(state, now) >= top + (isOwn(hold.eventId) ? 0 : AUTO_GRACE_MS)) {
        autoHold.current = hold.eventId;
        const matchClockMs = clockNowMs(state.clock, now, state.durationMs);
        enqueue({ type: 'HOLD_ENDED', side: hold.side, actionCode: null, value: top, matchClockMs });
      }
    }
  }, [state, log, now, active, match.rules, enqueue, isOwn]);
}

function MatchPanel({
  data,
  onChanged,
  onRecorded,
  serverOffsetMs,
}: {
  data: MatConsoleDto;
  onChanged: () => void;
  onRecorded: (m: MatchDetailDto) => void;
  /** Сервер − планшет, мс (по времени сервера в ответе). */
  serverOffsetMs: number;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const describe = useDescribe();
  const match = data.current as MatchDetailDto;
  const rules = useMemo(() => toScoringRules(match.rules), [match.rules]);
  const scoring = useScoring(match, rules, onChanged, serverOffsetMs);
  const live = match.status === 'IN_PROGRESS' || match.status === 'PAUSED';
  const now = useNow(live);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resulting, setResulting] = useState(false);
  const state = scoring.state;
  const canScore = match.status === 'IN_PROGRESS' && match.allowedActions.includes('event.create');
  const elapsed = state ? clockNowMs(state.clock, now, state.durationMs) : 0;
  useAutoEvents(match, scoring, now, canScore);

  const run: Run = useCallback(
    async (fn) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(describe(e));
      } finally {
        setBusy(false);
        onChanged();
      }
    },
    [describe, onChanged],
  );

  const notice = scoring.notice;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MatchTitle match={match} timezone={data.competition.timezone} />
        {live ? (
          <ConnectionBadge
            offline={scoring.offline}
            pending={scoring.pendingCount}
            sending={scoring.inFlight}
          />
        ) : null}
      </div>
      {notice ? (
        <Alert tone="warning">
          {notice.kind === 'reset'
            ? t('resetByServer', { count: notice.count ?? 0 })
            : t('rejected', {
                reason: notice.reason ? label.rejection(notice.reason) : describe(notice.error),
              })}
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {match.status === 'SCHEDULED' || match.status === 'READY' ? <Prestart match={match} run={run} /> : null}
      {live && state ? (
        <>
          <Scoreboard
            match={match}
            state={state}
            rules={match.rules}
            now={now}
            canScore={canScore}
            onEvent={scoring.enqueue}
          />
          {resulting ? (
            <ResultPanel
              match={match}
              state={state}
              rules={rules}
              serverSeq={scoring.serverSeq}
              onDone={(m) => {
                setResulting(false);
                onRecorded(m);
              }}
              onCancel={() => setResulting(false)}
            />
          ) : (
            <LiveControls
              match={match}
              scoring={scoring}
              elapsed={elapsed}
              busy={busy}
              run={run}
              onFinish={() => setResulting(true)}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function TabletHeader({ data, offline }: { data: MatConsoleDto; offline: boolean }) {
  const t = useTranslations('referee');
  const tRoles = useTranslations('scheduling.crews.roles');
  const locale = useLocale();
  const tz = data.competition.timezone;
  const roles = data.myRoles.map((r) => tRoles(r));
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div>
        <h1 className="text-2xl font-bold">
          {t('matTitle', { number: data.mat.number })} {data.mat.name ?? ''}
        </h1>
        <p className="text-sm text-slate-600">
          {data.competition.name}
          {data.session
            ? ` · ${t('session', { name: data.session.name })} ${timeInZone(data.session.startsAt, tz, locale)}–${timeInZone(data.session.endsAt, tz, locale)}`
            : ''}
          {' · '}
          {roles.length > 0 ? t('myRoles', { roles: roles.join(', ') }) : t('notAssigned')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {offline ? (
          <Badge tone="danger" className="px-3 py-1 text-sm">
            <span aria-hidden="true">■</span> {t('offline')}
          </Badge>
        ) : null}
        <Link
          href={`/referee/${data.competition.id}`}
          className="inline-flex min-h-12 items-center rounded-md border border-slate-300 bg-white px-4 font-medium hover:bg-slate-50"
        >
          {t('backToMats')}
        </Link>
      </div>
    </header>
  );
}

export function MatTablet({ matId }: { matId: string }) {
  const t = useTranslations('referee');
  const qc = useQueryClient();
  const query = useMatConsole(matId, false);
  // Записанный результат остаётся на экране, пока бригада не перейдёт к следующей схватке (или руководитель ковра
  // не подтвердит его), хотя очередь ковра уже показывает следующую.
  const [recorded, setRecorded] = useState<MatchDetailDto | null>(null);
  const onChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: refereeKeys.console(matId) });
  }, [qc, matId]);
  const keep = (m: MatchDetailDto): void => {
    setRecorded(m);
    onChanged();
  };
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4">
      <QueryState isPending={query.isPending} error={query.data ? null : query.error}>
        {() => {
          const data = query.data as MatConsoleDto;
          return (
            <>
              <TabletHeader data={data} offline={!!query.error} />
              {recorded ? (
                <RecordedPanel
                  match={recorded}
                  onUpdated={keep}
                  onClose={() => {
                    setRecorded(null);
                    onChanged();
                  }}
                />
              ) : data.current ? (
                <MatchPanel
                  key={data.current.id}
                  data={data}
                  onChanged={onChanged}
                  onRecorded={keep}
                  serverOffsetMs={Date.parse(data.serverTime) - query.dataUpdatedAt}
                />
              ) : (
                <EmptyState title={t('noCurrent')} />
              )}
              <NextAndAwaiting data={data} onChanged={onChanged} hide={recorded?.id} />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
