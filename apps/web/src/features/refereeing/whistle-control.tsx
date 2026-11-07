'use client';
// Режим «по свистку» на планшете ковра (идея 07.11.2026): свисток арбитра запускает время, следующий — останавливает.
// Защиты: режим включает руководитель ковра; срабатывает только во время схватки и пока время не вышло; повторный
// свисток в течение 1,5 с не считается; 3 секунды после срабатывания видна кнопка «Отменить», которая возвращает
// время как было; кнопки «Время»/«Стоп» работают как раньше.
import { clockNowMs, type MatchState } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useWhistle } from './use-whistle';
import type { Sensitivity } from './whistle-detect';

const UNDO_MS = 3000;

type ClockEvent = { type: 'CLOCK_STARTED' | 'CLOCK_STOPPED'; matchClockMs: number };

/** Последнее срабатывание: что сделал свисток и как вернуть. */
interface Fired {
  kind: 'started' | 'stopped';
  clockMs: number;
  at: number;
}

export function WhistleControl({
  state,
  active,
  onClock,
}: {
  state: MatchState;
  /** Можно вести схватку (идёт, есть право записи). */
  active: boolean;
  onClock: (e: ClockEvent) => void;
}) {
  const t = useTranslations('referee.whistle');
  const [fired, setFired] = useState<Fired | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const whistle = useWhistle(() => {
    const at = Date.now();
    const elapsed = clockNowMs(state.clock, at, state.durationMs);
    if (!active || state.decision) return;
    if (state.clock.running) {
      onClock({ type: 'CLOCK_STOPPED', matchClockMs: elapsed });
      setFired({ kind: 'stopped', clockMs: elapsed, at });
      setNow(at);
    } else {
      if (elapsed >= state.durationMs) return;
      onClock({ type: 'CLOCK_STARTED', matchClockMs: elapsed });
      setFired({ kind: 'started', clockMs: elapsed, at });
      setNow(at);
    }
  });

  useEffect(() => {
    if (!fired) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - fired.at >= UNDO_MS) setFired(null);
    }, 200);
    return () => clearInterval(id);
  }, [fired]);

  const undo = (): void => {
    if (!fired) return;
    if (fired.kind === 'started' && state.clock.running) {
      // ложный старт: время возвращается к моменту свистка
      onClock({ type: 'CLOCK_STOPPED', matchClockMs: fired.clockMs });
    } else if (fired.kind === 'stopped' && !state.clock.running) {
      // ложная остановка: время идёт дальше, секунды до отмены засчитываются
      const ms = Math.min(state.durationMs, fired.clockMs + (Date.now() - fired.at));
      onClock({ type: 'CLOCK_STARTED', matchClockMs: ms });
    }
    setFired(null);
  };

  const left = fired ? Math.min(3, Math.max(1, Math.ceil((UNDO_MS - (now - fired.at)) / 1000))) : 0;
  const statusText =
    whistle.calibration.phase === 'recording'
      ? t('calibrating', { count: whistle.calibration.count })
      : whistle.calibration.phase === 'failed'
        ? t('calibrationFailed')
        : whistle.status === 'denied'
          ? t('denied')
          : whistle.status === 'unsupported'
            ? t('unsupported')
            : whistle.status === 'listening'
              ? whistle.calibrated
                ? t('listening')
                : t('listeningDefault')
              : whistle.status === 'starting'
                ? t('starting')
                : t('off');

  return (
    <div className="w-full space-y-2">
      {fired ? (
        <button
          type="button"
          onClick={undo}
          className="min-h-14 w-full rounded-lg bg-white px-4 py-1 text-lg font-bold text-slate-900 ring-4 ring-amber-400 hover:bg-amber-50"
        >
          <span className="block text-sm font-semibold text-slate-600">
            {t(fired.kind === 'started' ? 'firedStart' : 'firedStop')}
          </span>
          <span className="block">↶ {t('undo', { seconds: left })}</span>
        </button>
      ) : null}
      <div className="rounded-lg bg-slate-800 p-2 text-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={whistle.enabled}
            onClick={() => whistle.setEnabled(!whistle.enabled)}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-md px-3 font-semibold',
              whistle.enabled ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-200',
            )}
          >
            <span aria-hidden>📣</span>
            {t(whistle.enabled ? 'on' : 'offShort')}
          </button>
          <div
            className="h-2 flex-1 overflow-hidden rounded bg-slate-700"
            role="meter"
            aria-label={t('level')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(whistle.level * 100)}
          >
            <div
              className={cn(
                'h-full transition-[width] duration-100',
                whistle.level > 0.8 ? 'bg-emerald-400' : 'bg-slate-400',
              )}
              style={{ width: `${Math.round(whistle.level * 100)}%` }}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-300">{statusText}</p>
        {whistle.enabled || whistle.calibration.phase !== 'idle' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={whistle.calibration.phase === 'recording'}
              onClick={whistle.calibrate}
              className="min-h-9 rounded-md bg-slate-700 px-3 text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            >
              {t(whistle.calibrated ? 'recalibrate' : 'calibrate')}
            </button>
            <label className="flex items-center gap-1 text-slate-300">
              {t('sensitivity')}
              <select
                value={whistle.sensitivity}
                onChange={(e) => whistle.setSensitivity(e.target.value as Sensitivity)}
                className="min-h-9 rounded-md bg-slate-700 px-2 text-slate-100"
              >
                {(['low', 'medium', 'high'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`sensitivity_${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
