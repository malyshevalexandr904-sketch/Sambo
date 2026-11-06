'use client';
// Анимации профиля: счётчик «набегает» до значения, кольцо процента побед заполняется. При «уменьшить движение»
// значение показывается сразу.
import { useEffect, useState } from 'react';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reducedMotion() || target === 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now + delayMs;
      const p = Math.min(Math.max((now - start) / durationMs, 0), 1);
      // easeOutCubic
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, delayMs]);
  return value;
}

export function CountUp({ value, delayMs }: { value: number; delayMs?: number }) {
  const shown = useCountUp(value, 900, delayMs);
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

/** Кольцо доли (0…1) с подписью в центре. */
export function Ring({
  share,
  label,
  sub,
  size = 112,
}: {
  share: number;
  label: string;
  sub: string;
  size?: number;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(id);
  }, [share]);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-slate-200" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className="stroke-emerald-500"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{label}</span>
        <span className="text-xs text-slate-600">{sub}</span>
      </div>
    </div>
  );
}
