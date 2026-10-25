'use client';
// Трекер Elo в кабинете спортсмена (docs/RATED_ONLY.md, 5): рейтинг от схватки к схватке. X — номер схватки (а не
// время: схватки одного дня не слипаются), Y — рейтинг после схватки; первая точка — рейтинг до первой схватки.
// Точка схватки — победа (●, зелёная) или поражение (▼, красная): исход читается и без цвета. Наведение, касание и
// стрелки клавиатуры показывают схватку: дату, турнир, соперника, исход и изменение рейтинга.
import type { PublicRatingHistoryItem } from '@sde/contracts';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const isWin = (b: PublicRatingHistoryItem): boolean | null =>
  b.kind === 'CORRECTION' ? null : b.delta > 0 || (b.outcome?.includes('WIN') ?? false);

export function EloTracker({ bouts, locale }: { bouts: PublicRatingHistoryItem[]; locale: string }) {
  const t = useTranslations('athleteProgress');
  const tr = useTranslations('rating');
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  // Точка 0 — рейтинг до первого события, точки 1…N — после каждого события.
  const ratings = useMemo(
    () => (bouts.length ? [bouts[0]!.ratingBefore, ...bouts.map((b) => b.ratingAfter)] : []),
    [bouts],
  );
  const model = useMemo(() => {
    const lo = Math.min(...ratings);
    const hi = Math.max(...ratings);
    const step = niceStep(Math.max(hi - lo, 20));
    const min = Math.floor(lo / step) * step;
    const max = Math.max(Math.ceil(hi / step) * step, min + step);
    const n = Math.max(ratings.length - 1, 1);
    const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right);
    const y = (r: number) => PAD.top + ((max - r) / (max - min)) * (H - PAD.top - PAD.bottom);
    const ticks: number[] = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    return { x, y, ticks };
  }, [ratings]);
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (bouts.length === 0) return null;
  const path = ratings
    .map((r, i) => `${i ? 'L' : 'M'}${model.x(i).toFixed(1)},${model.y(r).toFixed(1)}`)
    .join('');
  const nearest = (clientX: number): number => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return 1;
    const sx = ((clientX - box.left) / box.width) * W;
    let best = 1;
    for (let i = 1; i < ratings.length; i++)
      if (Math.abs(model.x(i) - sx) < Math.abs(model.x(best) - sx)) best = i;
    return best;
  };
  // Подписи номеров схваток по оси X: не больше 10, чтобы не наползали.
  const every = Math.max(1, Math.ceil(bouts.length / 10));
  const a = active === null ? null : bouts[active - 1];
  return (
    <figure className="relative mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={t('chartLabel', {
          count: bouts.length,
          from: ratings[0]!,
          to: ratings[ratings.length - 1]!,
          peak: Math.max(...ratings),
        })}
        tabIndex={0}
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerDown={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? 0) + 1, bouts.length));
          else if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? bouts.length + 1) - 1, 1));
          else if (e.key === 'Escape') setActive(null);
        }}
      >
        {model.ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={model.y(v)}
              y2={model.y(v)}
              className="stroke-slate-200"
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={model.y(v) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {v}
            </text>
          </g>
        ))}
        <text x={model.x(0)} y={H - 10} textAnchor="middle" className="fill-slate-500 text-[11px]">
          {t('start')}
        </text>
        {bouts.map((_, i) =>
          (i + 1) % every === 0 || i === bouts.length - 1 ? (
            <text
              key={i}
              x={model.x(i + 1)}
              y={H - 10}
              textAnchor="middle"
              className="fill-slate-500 text-[11px] tabular-nums"
            >
              {i + 1}
            </text>
          ) : null,
        )}
        {active !== null ? (
          <line
            x1={model.x(active)}
            x2={model.x(active)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            className="stroke-slate-400"
            strokeWidth={1}
          />
        ) : null}
        <path d={path} fill="none" className="stroke-blue-700" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={model.x(0)} cy={model.y(ratings[0]!)} r={3.5} className="fill-slate-400" />
        {bouts.map((b, i) => {
          const cx = model.x(i + 1);
          const cy = model.y(b.ratingAfter);
          const win = isWin(b);
          const r = active === i + 1 ? 6 : 4;
          if (win === false)
            return (
              <path
                key={i}
                d={`M${cx - r},${cy - r * 0.8}L${cx + r},${cy - r * 0.8}L${cx},${cy + r}Z`}
                className="fill-red-600 stroke-white"
                strokeWidth={1.5}
              />
            );
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              className={win ? 'fill-green-600 stroke-white' : 'fill-slate-500 stroke-white'}
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
      {a && active !== null ? (
        <div
          className="pointer-events-none absolute top-2 max-w-[16rem] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow"
          style={{
            left: `${(model.x(active) / W) * 100}%`,
            transform: `translateX(${model.x(active) > W / 2 ? '-105%' : '5%'})`,
          }}
          aria-live="polite"
        >
          <div className="font-medium text-slate-900">
            {a.kind === 'CORRECTION' ? tr('correction') : t('bout', { n: active })} ·{' '}
            {date.format(new Date(a.at))}
          </div>
          {a.competition ? <div className="text-slate-600">{a.competition.name}</div> : null}
          {a.outcome ? <div className="text-slate-700">{tr(`outcomes.${a.outcome}`)}</div> : null}
          {a.opponent ? (
            <div className="text-slate-600">
              {t('opponent', {
                name: a.opponent.name ?? tr('hiddenAthlete'),
                rating: a.opponent.ratingBefore,
              })}
            </div>
          ) : null}
          <div className="font-semibold tabular-nums text-slate-900">
            {a.ratingBefore} → {a.ratingAfter}{' '}
            <span className={a.delta >= 0 ? 'text-green-800' : 'text-red-800'}>
              ({a.delta > 0 ? '+' : ''}
              {a.delta})
            </span>
          </div>
        </div>
      ) : null}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>
          <span aria-hidden="true" className="text-green-700">
            ●
          </span>{' '}
          {t('legendWin')}
        </span>
        <span>
          <span aria-hidden="true" className="text-red-700">
            ▼
          </span>{' '}
          {t('legendLoss')}
        </span>
        <span>{t('legendAxis')}</span>
      </figcaption>
    </figure>
  );
}
