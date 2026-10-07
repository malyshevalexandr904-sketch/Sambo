'use client';
// Счёт и время на планшете ковра (план Phase 7a, §5): красный слева, синий справа — «Фамилия И.», клуб, баллы
// крупно, наказания; основной таймер и таймер удержания; крупные кнопки оценок из правил турнира, удержание
// старт/стоп, наказание (следующее по порядку). Цели касания ≥ 48 px; статус — цветом и текстом.
import {
  clockNowMs,
  type MatchDetailDto,
  type MatchRulesDto,
  type MatchSideDto,
  type MatchState,
  type Side,
} from '@sde/contracts';
import { Badge, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { formatClock, useRefereeLabels } from './labels';
import type { EventInput } from './use-scoring';

const SIDE_STYLE: Record<Side, { box: string; bar: string; button: string; strong: string }> = {
  RED: {
    box: 'border-red-600 bg-red-50',
    bar: 'bg-red-600',
    button: 'border-red-300 bg-white text-red-900 hover:bg-red-100 active:bg-red-200',
    strong: 'bg-red-700 text-white hover:bg-red-800',
  },
  BLUE: {
    box: 'border-blue-600 bg-blue-50',
    bar: 'bg-blue-600',
    button: 'border-blue-300 bg-white text-blue-900 hover:bg-blue-100 active:bg-blue-200',
    strong: 'bg-blue-700 text-white hover:bg-blue-800',
  },
};

const BTN =
  'min-h-12 rounded-lg border-2 px-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40';

export function holdElapsedMs(state: MatchState, now: number): number {
  return state.hold ? Math.max(0, now - Date.parse(state.hold.startedAt)) : 0;
}

export function maxHoldMs(rules: MatchRulesDto): number {
  return Math.max(0, ...rules.hold.thresholds.map((t) => t.seconds)) * 1000;
}

function SidePanel({
  side,
  info,
  state,
  rules,
  now,
  canScore,
  onEvent,
  clockMs,
}: {
  side: Side;
  info: MatchSideDto;
  state: MatchState;
  rules: MatchRulesDto;
  now: number;
  canScore: boolean;
  onEvent: (e: EventInput) => void;
  clockMs: number;
}) {
  const t = useTranslations('referee');
  const label = useRefereeLabels();
  const s = side === 'RED' ? state.red : state.blue;
  const style = SIDE_STYLE[side];
  const decided = state.decision !== null;
  const myHold = state.hold?.side === side;
  const holdMs = myHold ? holdElapsedMs(state, now) : 0;
  const holdTop = maxHoldMs(rules);
  const nextPenalty = rules.penalties[s.penalties.length];
  const event = (e: Omit<EventInput, 'side' | 'matchClockMs'> & { matchClockMs?: number }): void =>
    onEvent({ side, matchClockMs: clockMs, ...e });
  return (
    <section
      aria-label={label.side(side)}
      className={cn('flex min-w-0 flex-col gap-3 rounded-xl border-l-8 p-4', style.box)}
    >
      <header className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">{label.side(side)}</p>
        <p className="truncate text-2xl font-bold text-slate-900 md:text-3xl">{info.publicName ?? '—'}</p>
        <p className="truncate text-sm text-slate-600">
          {info.club ?? ''}
          {info.withdrawn ? (
            <Badge tone="warning" className="ml-2">
              {t('withdrawn')}
            </Badge>
          ) : null}
        </p>
      </header>
      <p
        className="text-center font-mono text-7xl font-bold tabular-nums text-slate-900 md:text-8xl"
        aria-live="polite"
      >
        <span className="sr-only">{t('score')}: </span>
        {s.points}
      </p>
      <p className="min-h-6 text-sm text-slate-700">
        {s.penalties.length > 0 ? s.penalties.map((p) => label.code(p)).join(' · ') : t('penaltiesNone')}
        {s.holds > 0 ? ` · ${t('holdUsed')}` : ''}
      </p>
      {myHold ? (
        <div role="status" className="rounded-lg bg-white p-2">
          <p className="text-lg font-semibold">{t('holdRunning', { seconds: Math.floor(holdMs / 1000) })}</p>
          <div className="relative mt-1 h-3 rounded bg-slate-200" aria-hidden="true">
            <div
              className={cn('h-3 rounded', style.bar)}
              style={{ width: `${Math.min(100, (holdMs / Math.max(1, holdTop)) * 100)}%` }}
            />
            {rules.hold.thresholds.map((th) => (
              <span
                key={th.seconds}
                className="absolute top-0 h-3 w-0.5 bg-slate-900"
                style={{ left: `${(th.seconds * 1000 * 100) / Math.max(1, holdTop)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
      {canScore ? (
        <div className="grid grid-cols-2 gap-2">
          {rules.actions.map((a) => (
            <button
              key={a.code}
              type="button"
              disabled={decided}
              className={cn(
                BTN,
                a.totalVictory ? style.strong : style.button,
                a.totalVictory && 'col-span-2 border-transparent',
              )}
              onClick={() => event({ type: 'SCORE', actionCode: a.code, value: null })}
            >
              {a.totalVictory
                ? `${t('totalVictory')}: ${label.code(a.code)}`
                : `+${a.points ?? 0} ${label.code(a.code, a.points)}`}
            </button>
          ))}
          {myHold ? (
            <button
              type="button"
              className={cn(BTN, 'col-span-2', style.strong)}
              onClick={() =>
                event({ type: 'HOLD_ENDED', actionCode: null, value: Math.min(holdMs, holdTop) })
              }
            >
              {t('holdStop')}
            </button>
          ) : (
            <button
              type="button"
              disabled={
                decided || state.hold !== null || !state.clock.running || s.holds >= rules.hold.maxPerMatch
              }
              className={cn(BTN, 'col-span-2', style.button)}
              onClick={() => event({ type: 'HOLD_STARTED', actionCode: null, value: null })}
            >
              {t('holdStart')}
            </button>
          )}
          <button
            type="button"
            disabled={decided || !nextPenalty}
            className={cn(BTN, 'col-span-2 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100')}
            onClick={() => event({ type: 'PENALTY', actionCode: nextPenalty?.code ?? null, value: null })}
          >
            {t('penaltyNext', { name: label.code(nextPenalty?.code ?? '') })}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function Scoreboard({
  match,
  state,
  rules,
  now,
  canScore,
  onEvent,
}: {
  match: MatchDetailDto;
  state: MatchState;
  rules: MatchRulesDto;
  now: number;
  canScore: boolean;
  onEvent: (e: EventInput) => void;
}) {
  const t = useTranslations('referee');
  const elapsed = clockNowMs(state.clock, now, state.durationMs);
  const remaining = state.durationMs - elapsed;
  const timeUp = remaining <= 0 && !state.clock.running;
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_minmax(12rem,auto)_1fr]">
      <SidePanel
        side="RED"
        info={match.red}
        state={state}
        rules={rules}
        now={now}
        canScore={canScore}
        onEvent={onEvent}
        clockMs={elapsed}
      />
      <section
        aria-label={t('remaining')}
        className="order-first flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-900 p-4 text-white md:order-none"
      >
        <p className="text-sm uppercase tracking-wide text-slate-300">
          {timeUp ? t('timeUp') : t('remaining')}
        </p>
        <p className="font-mono text-6xl font-bold tabular-nums md:text-7xl" role="timer" aria-live="off">
          {formatClock(remaining)}
        </p>
        {state.hold ? (
          <p className="rounded bg-amber-400 px-2 py-1 font-semibold text-slate-900">
            {t('holdRunning', { seconds: Math.floor(holdElapsedMs(state, now) / 1000) })}
          </p>
        ) : null}
        {canScore ? (
          state.clock.running ? (
            <button
              type="button"
              className="min-h-14 w-full rounded-lg bg-amber-400 px-6 text-xl font-bold text-slate-900 hover:bg-amber-300"
              onClick={() =>
                onEvent({
                  type: 'CLOCK_STOPPED',
                  side: null,
                  actionCode: null,
                  value: null,
                  matchClockMs: elapsed,
                })
              }
            >
              {t('clockStop')}
            </button>
          ) : (
            <button
              type="button"
              disabled={timeUp}
              className="min-h-14 w-full rounded-lg bg-emerald-500 px-6 text-xl font-bold text-slate-900 hover:bg-emerald-400 disabled:opacity-40"
              onClick={() =>
                onEvent({
                  type: 'CLOCK_STARTED',
                  side: null,
                  actionCode: null,
                  value: null,
                  matchClockMs: elapsed,
                })
              }
            >
              {t('clockStart')}
            </button>
          )
        ) : null}
      </section>
      <SidePanel
        side="BLUE"
        info={match.blue}
        state={state}
        rules={rules}
        now={now}
        canScore={canScore}
        onEvent={onEvent}
        clockMs={elapsed}
      />
    </div>
  );
}
