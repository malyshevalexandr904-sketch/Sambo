'use client';
// График Elo спортсмена (ТЗ 40): X — время, Y — рейтинг после каждой посчитанной схватки и корректировки. Один ряд —
// без легенды; ось Y по округлённым границам, сетка приглушённая; наведение (мышь, касание, клавиатура) показывает
// дату и рейтинг ближайшей точки. Таблица значений — история ниже на странице.
import { useMemo, useRef, useState } from 'react';

const W = 720;
const H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };

interface Point {
  at: string;
  rating: number;
}

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function RatingChart({
  points,
  locale,
  label,
}: {
  points: Point[];
  locale: string;
  /** Подпись для чтения с экрана, например «График рейтинга: от 200 до 315». */
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const model = useMemo(() => {
    const ratings = points.map((p) => p.rating);
    const lo = Math.min(...ratings);
    const hi = Math.max(...ratings);
    const step = niceStep(Math.max(hi - lo, 20));
    const min = Math.floor(lo / step) * step;
    const max = Math.max(Math.ceil(hi / step) * step, min + step);
    const times = points.map((p) => new Date(p.at).getTime());
    const t0 = times[0] ?? 0;
    const t1 = times[times.length - 1] ?? 1;
    // Время — по порядку событий, если все в один момент; иначе — по шкале времени.
    const x = (i: number) =>
      PAD.left +
      (t1 > t0 ? ((times[i] ?? t0) - t0) / (t1 - t0) : points.length > 1 ? i / (points.length - 1) : 0.5) *
        (W - PAD.left - PAD.right);
    const y = (r: number) => PAD.top + ((max - r) / (max - min)) * (H - PAD.top - PAD.bottom);
    const ticks: number[] = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    return { x, y, ticks, t0, t1 };
  }, [points]);
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (points.length < 2) return null;
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${model.x(i).toFixed(1)},${model.y(p.rating).toFixed(1)}`)
    .join('');
  const nearest = (clientX: number): number => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return 0;
    const sx = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(model.x(i) - sx) < Math.abs(model.x(best) - sx)) best = i;
    return best;
  };
  const a = active === null ? null : points[active];
  return (
    <figure className="relative mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerDown={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? -1) + 1, points.length - 1));
          else if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? points.length) - 1, 0));
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
        <text x={PAD.left} y={H - 8} className="fill-slate-500 text-[11px]">
          {date.format(new Date(model.t0))}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-slate-500 text-[11px]">
          {date.format(new Date(model.t1))}
        </text>
        <path d={path} fill="none" className="stroke-blue-700" strokeWidth={2} strokeLinejoin="round" />
        {a && active !== null ? (
          <g>
            <line
              x1={model.x(active)}
              x2={model.x(active)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-slate-400"
              strokeWidth={1}
            />
            <circle
              cx={model.x(active)}
              cy={model.y(a.rating)}
              r={5}
              className="fill-blue-700 stroke-white"
              strokeWidth={2}
            />
          </g>
        ) : (
          <circle
            cx={model.x(points.length - 1)}
            cy={model.y(points[points.length - 1]!.rating)}
            r={4}
            className="fill-blue-700 stroke-white"
            strokeWidth={2}
          />
        )}
      </svg>
      {a && active !== null ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow"
          style={{
            left: `${(model.x(active) / W) * 100}%`,
            transform: `translateX(${model.x(active) > W / 2 ? '-105%' : '5%'})`,
          }}
          aria-live="polite"
        >
          <div className="text-slate-600">{date.format(new Date(a.at))}</div>
          <div className="font-semibold tabular-nums text-slate-900">{a.rating}</div>
        </div>
      ) : null}
    </figure>
  );
}
