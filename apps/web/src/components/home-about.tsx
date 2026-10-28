'use client';
// «О платформе» на главной (правки 28.10.2026): суть платформы, для кого она, какие проблемы решает, и уникальная
// рейтинговая система с калькулятором. Блоки появляются при прокрутке; формула — как в docs/RATING_RULES.md
// (Elo, K по рейтингу, 8 исходов, уровни 1–10). Калькулятор — пояснение, расчёт рейтинга делает сервер.
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { RatingCalculator } from './rating-calculator';

const AUDIENCE = ['ORGANIZATION_HEAD', 'COACH', 'ATHLETE', 'REFEREE'] as const;
const PROBLEMS = ['paper', 'draw', 'results', 'data'] as const;
const STATS = [
  { key: 'roles', value: 4 },
  { key: 'outcomes', value: 8 },
  { key: 'levels', value: 10 },
  { key: 'start', value: 200 },
] as const;
const RATING_STEPS = ['start', 'match', 'quality', 'level'] as const;

/** Появление блока при прокрутке до него. */
function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition duration-700 ease-out',
        seen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Число «набегает» от нуля, когда блок показался. */
function CountUp({ value }: { value: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - startedAt) / 1200);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, value]);
  return (
    <span ref={ref} className="tabular-nums">
      {shown}
    </span>
  );
}

function SectionTitle({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <Reveal>
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{eyebrow}</p>
      <h2 id={id} className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
        {title}
      </h2>
      {lead ? <p className="mt-3 max-w-3xl text-slate-700">{lead}</p> : null}
    </Reveal>
  );
}

function Audience() {
  const t = useTranslations('about.audience');
  const tr = useTranslations('cabinetRole.roles');
  const [role, setRole] = useState<(typeof AUDIENCE)[number]>('ORGANIZATION_HEAD');
  return (
    <section aria-labelledby="about-audience" className="mt-16">
      <SectionTitle id="about-audience" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      <Reveal className="mt-6">
        <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-2">
          {AUDIENCE.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              id={`aud-tab-${r}`}
              aria-selected={role === r}
              aria-controls="aud-panel"
              onClick={() => setRole(r)}
              className={cn(
                'min-h-11 rounded-full border px-4 text-sm font-medium transition',
                role === r
                  ? 'border-blue-700 bg-blue-700 text-white shadow'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400',
              )}
            >
              {tr(r)}
            </button>
          ))}
        </div>
        <div
          key={role}
          id="aud-panel"
          role="tabpanel"
          aria-labelledby={`aud-tab-${role}`}
          className="mt-4 grid animate-fade-up gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <div>
            <h3 className="text-xl font-semibold text-slate-900">{tr(role)}</h3>
            <p className="mt-2 text-slate-700">{t(`${role}.text`)}</p>
          </div>
          <ul className="space-y-2">
            {(['b1', 'b2', 'b3'] as const).map((b, i) => (
              <li
                key={b}
                className="flex animate-fade-up gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800"
                style={{ animationDelay: `${100 + i * 90}ms` }}
              >
                <span aria-hidden="true" className="font-bold text-blue-700">
                  ✓
                </span>
                {t(`${role}.${b}`)}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}

function Problems() {
  const t = useTranslations('about.problems');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <section aria-labelledby="about-problems" className="mt-16">
      <SectionTitle id="about-problems" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {PROBLEMS.map((p, i) => {
          const solved = open.has(p);
          return (
            <Reveal key={p} delay={i * 100}>
              <button
                type="button"
                aria-pressed={solved}
                onClick={() => toggle(p)}
                className={cn(
                  'flex h-full min-h-40 w-full flex-col rounded-xl border p-5 text-left shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md',
                  solved ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white',
                )}
              >
                <span
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    solved ? 'text-blue-800' : 'text-slate-500',
                  )}
                >
                  {solved ? t('after') : t('before')}
                </span>
                <span key={String(solved)} className="mt-2 block flex-1 animate-fade-up">
                  <span className="block font-semibold text-slate-900">
                    {t(`${p}.${solved ? 'solutionTitle' : 'problemTitle'}`)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-700">
                    {t(`${p}.${solved ? 'solution' : 'problem'}`)}
                  </span>
                </span>
                <span className="mt-3 text-sm font-medium text-blue-700">
                  {solved ? t('showProblem') : t('showSolution')}
                </span>
              </button>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Rating() {
  const t = useTranslations('about.rating');
  const [step, setStep] = useState(0);
  return (
    <section aria-labelledby="about-rating" className="mt-16">
      <SectionTitle id="about-rating" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Reveal>
          <ol className="relative space-y-2 border-l-2 border-slate-200 pl-5">
            {RATING_STEPS.map((s, i) => {
              const active = i === step;
              return (
                <li key={s} className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-[1.95rem] top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 transition',
                      active ? 'scale-110 border-blue-700 bg-blue-700' : 'border-slate-300 bg-white',
                    )}
                  />
                  <button
                    type="button"
                    aria-expanded={active}
                    onClick={() => setStep(i)}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left transition',
                      active ? 'bg-blue-50' : 'hover:bg-slate-100',
                    )}
                  >
                    <span className="block font-semibold text-slate-900">{t(`steps.${s}.title`)}</span>
                    {active ? (
                      <span className="mt-1 block animate-fade-up text-sm text-slate-700">
                        {t(`steps.${s}.text`)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-700">{t('levelsTitle')}</p>
            <div className="mt-3 flex items-end gap-1" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-blue-700 transition-all duration-700"
                  style={{ height: `${8 + i * 6}px`, opacity: 0.35 + i * 0.065 }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>{t('levelLow')}</span>
              <span>{t('levelHigh')}</span>
            </div>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <RatingCalculator />
        </Reveal>
      </div>
    </section>
  );
}

export function HomeAbout() {
  const t = useTranslations('about');
  return (
    <div id="about" className="scroll-mt-4 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <section aria-labelledby="about-title">
          <SectionTitle id="about-title" eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {STATS.map((s, i) => (
              <Reveal key={s.key} delay={i * 100}>
                <div className="h-full rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <p className="text-3xl font-bold text-blue-700">
                    <CountUp value={s.value} />
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{t(`stats.${s.key}`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(['p1', 'p2', 'p3'] as const).map((p, i) => (
              <Reveal key={p} delay={i * 120}>
                <div className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900">{t(`essence.${p}.title`)}</h3>
                  <p className="mt-2 text-sm text-slate-700">{t(`essence.${p}.text`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
        <Audience />
        <Problems />
        <Rating />
        <Reveal className="mt-16">
          <div className="rounded-xl bg-blue-700 p-6 text-center text-white shadow-md sm:p-8">
            <h2 className="text-2xl font-bold">{t('cta.title')}</h2>
            <p className="mx-auto mt-2 max-w-2xl text-white/85">{t('cta.text')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className="theme-light inline-flex min-h-11 items-center rounded-md bg-white px-6 font-semibold text-blue-800 shadow-sm transition hover:-translate-y-0.5"
              >
                {t('cta.register')}
              </Link>
              <Link
                href="/rating"
                className="inline-flex min-h-11 items-center rounded-md px-6 font-semibold text-white ring-1 ring-white/50 transition hover:bg-white/10"
              >
                {t('cta.rating')}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
