'use client';
// Калькулятор рейтинга на главной (правки 28.10.2026): рейтинги двух спортсменов, исход схватки и результат.
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { eloAfter, expected, kOf, levelOf, OUTCOMES } from '@/lib/rating-example';

export function RatingCalculator() {
  const t = useTranslations('about.rating.calc');
  const [a, setA] = useState(200);
  const [b, setB] = useState(350);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['key']>('CLEAN_WIN');
  const sA = OUTCOMES.find((o) => o.key === outcome)!.s;
  const [a2, b2] = eloAfter(a, b, sA);
  const chance = Math.round(expected(a, b) * 100);
  const max = 1500;
  const side = (name: string, before: number, after: number, set: (v: number) => void, id: string) => {
    const delta = after - before;
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label
          htmlFor={id}
          className="flex items-baseline justify-between gap-2 text-sm font-medium text-slate-700"
        >
          <span>{name}</span>
          <span className="text-2xl font-bold tabular-nums text-slate-900">{before}</span>
        </label>
        <input
          id={id}
          type="range"
          min={50}
          max={max}
          step={5}
          value={before}
          onChange={(e) => set(Number(e.target.value))}
          className="mt-2 w-full accent-blue-700"
        />
        <p className="mt-1 text-xs text-slate-500">
          {t('kAndLevel', { k: kOf(before), level: levelOf(before) })}
        </p>
        <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-slate-200 pt-3">
          <span className="text-sm text-slate-600">{t('after')}</span>
          <span className="flex items-baseline gap-2">
            <span key={after} className="animate-fade-up text-xl font-bold tabular-nums text-slate-900">
              {after}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums',
                delta > 0
                  ? 'bg-green-100 text-green-800'
                  : delta < 0
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-100 text-slate-700',
              )}
            >
              {delta > 0 ? `+${delta}` : delta}
            </span>
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">{t('title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('hint')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {side(t('athleteA'), a, a2, setA, 'calc-a')}
        {side(t('athleteB'), b, b2, setB, 'calc-b')}
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-slate-700">{t('chance', { chance })}</p>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="bg-blue-700 transition-all duration-500" style={{ width: `${chance}%` }} />
        </div>
      </div>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">{t('outcome')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <label
              key={o.key}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition',
                outcome === o.key
                  ? 'border-blue-600 bg-blue-50 font-medium text-slate-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300',
              )}
            >
              <input
                type="radio"
                name="calc-outcome"
                value={o.key}
                checked={outcome === o.key}
                onChange={() => setOutcome(o.key)}
                className="accent-blue-700"
              />
              <span className="flex-1">{t(`outcomes.${o.key}`)}</span>
              <span className="tabular-nums text-xs text-slate-500">
                {o.s} / {Math.round((1 - o.s) * 10) / 10}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-xs text-slate-500">{t('note')}</p>
    </div>
  );
}
