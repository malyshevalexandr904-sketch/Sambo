'use client';
// Афиша турнира (правки 05.11.2026): постер в одном из шаблонов и регламент — краткая выжимка положения.
// Шаблоны собраны по мотивам афиш соревнований по самбо: крупная дата, название, город, красный и синий цвета
// формы самбистов. Цвета постера заданы явно (style), поэтому тёмная тема их не меняет.
import {
  isPosterTemplate,
  type PosterTemplate,
  type PublicCompetition,
  type PublicCompetitionCategory,
} from '@sde/contracts';
import { cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';

export interface PosterData {
  name: string;
  startDate: string;
  endDate: string;
  city: string | null;
  venueName: string | null;
  organizerName: string;
  logoUrl: string | null;
  rated: boolean;
  /** Возрастные группы: «Юноши 2012–2013 г.р.». */
  groups: string[];
}

const MONTHS_RU = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Крупная дата постера: «14» и «ноября 2026» (диапазон — «14–15»). */
export function posterDate(start: string, end: string, locale: string): { day: string; rest: string } {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  const month = (d: Date) =>
    locale === 'en'
      ? d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })
      : (MONTHS_RU[d.getUTCMonth()] ?? '');
  if (start === end) return { day: String(s.getUTCDate()), rest: `${month(s)} ${s.getUTCFullYear()}` };
  if (sameMonth)
    return { day: `${s.getUTCDate()}–${e.getUTCDate()}`, rest: `${month(s)} ${s.getUTCFullYear()}` };
  return {
    day: `${s.getUTCDate()} ${month(s).slice(0, 3)} – ${e.getUTCDate()} ${month(e).slice(0, 3)}`,
    rest: String(e.getUTCFullYear()),
  };
}

function ageLabel(c: PublicCompetitionCategory, locale: string): string {
  const a = c.age;
  const range = (from: number | null, to: number | null) =>
    from !== null && to !== null && from !== to ? `${from}–${to}` : String(from ?? to ?? '');
  if (a.birthYearFrom !== null || a.birthYearTo !== null)
    return `${range(a.birthYearFrom, a.birthYearTo)} ${locale === 'en' ? 'born' : 'г.р.'}`;
  if (a.ageFrom !== null || a.ageTo !== null)
    return `${range(a.ageFrom, a.ageTo)} ${locale === 'en' ? 'y.o.' : 'лет'}`;
  return '';
}

/** Группа категории: название без веса («Юноши 12–13 лет») и возраст. */
export function groupOf(c: PublicCompetitionCategory, locale: string): string {
  const title = (locale === 'en' ? c.name.en : c.name.ru).split(',')[0]?.trim() ?? '';
  const age = ageLabel(c, locale);
  return age && !title.includes(age.split(' ')[0] ?? '') ? `${title} · ${age}` : title;
}

export function posterDataOf(c: PublicCompetition, locale: string): PosterData {
  const groups = [...new Set(c.categories.map((x) => groupOf(x, locale)).filter(Boolean))];
  return {
    name: c.name,
    startDate: c.startDate,
    endDate: c.endDate,
    city: c.venue?.city ?? c.city,
    venueName: c.venue?.name ?? null,
    organizerName: c.organizerName,
    logoUrl: c.logoUrl,
    rated: c.competitionType === 'RATED',
    groups,
  };
}

const FONT: CSSProperties = { fontFamily: 'inherit' };

/** Силуэт двух борцов (захват): общий для шаблонов, цвет — currentColor. */
function Wrestlers({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 200 160" aria-hidden="true" className={className} style={style} fill="currentColor">
      <circle cx="62" cy="30" r="14" />
      <circle cx="140" cy="34" r="14" />
      <path d="M50 48c-14 8-22 26-24 46l-8 52h20l10-40 12 40h20l-8-56 22-18 20 12-6 62h20l8-60 14 58h20l-10-64c-2-20-12-34-26-40l-24 6-28-16z" />
      <path d="M78 64l30 10 26-14" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Brand({ color }: { color: string }) {
  return (
    <p className="text-[0.7em] font-semibold uppercase tracking-[0.2em]" style={{ color }}>
      Цифровое самбо
    </p>
  );
}

function Logo({ url }: { url: string | null }) {
  if (!url) return null;
  return <img src={url} alt="" className="h-[3.2em] w-[3.2em] rounded-md bg-white/90 object-contain p-1" />;
}

function Groups({ groups, style }: { groups: string[]; style?: CSSProperties }) {
  if (groups.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-[0.4em]">
      {groups.slice(0, 4).map((g) => (
        <li key={g} className="rounded-full px-[0.8em] py-[0.25em] text-[0.62em] font-medium" style={style}>
          {g}
        </li>
      ))}
    </ul>
  );
}

function Frame({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={cn('relative aspect-[4/5] w-full overflow-hidden rounded-2xl shadow-xl', className)}
      style={{ ...FONT, ...style }}
    >
      {children}
    </div>
  );
}

function Classic({ d, locale, t }: TemplateProps) {
  const date = posterDate(d.startDate, d.endDate, locale);
  return (
    <Frame style={{ background: '#0b1f4d', color: '#fff' }}>
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(115deg, #c8102e 0 38%, transparent 38%)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(115deg, transparent 0 40%, #1d4ed8 40% 46%, transparent 46%)' }}
      />
      <Wrestlers className="absolute -right-[4%] bottom-[18%] w-[62%] opacity-25" style={{ color: '#fff' }} />
      <div className="relative flex h-full flex-col justify-between p-[1.4em]">
        <div className="flex items-start justify-between gap-3">
          <Brand color="#fde68a" />
          <Logo url={d.logoUrl} />
        </div>
        <div>
          <p className="text-[3.6em] font-black leading-none">{date.day}</p>
          <p className="text-[1.1em] font-semibold uppercase">{date.rest}</p>
          <h3
            className="mt-[0.6em] font-extrabold uppercase leading-tight"
            style={{ fontSize: nameSize(d.name, 1.45) }}
          >
            {d.name}
          </h3>
          {d.city ? (
            <p className="mt-[0.3em] text-[0.85em] opacity-90">
              {d.city}
              {d.venueName ? ` · ${d.venueName}` : ''}
            </p>
          ) : null}
          <div className="mt-[0.8em]">
            <Groups groups={d.groups} style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }} />
          </div>
        </div>
        <div className="flex items-center justify-between text-[0.62em] opacity-90">
          <span>{d.organizerName}</span>
          {d.rated ? (
            <span className="rounded bg-amber-300 px-2 py-0.5 font-bold text-amber-950">{t('rated')}</span>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

function Arena({ d, locale, t }: TemplateProps) {
  const date = posterDate(d.startDate, d.endDate, locale);
  return (
    <Frame
      style={{
        background: 'radial-gradient(circle at 50% 30%, #3b4a6b 0%, #0f172a 55%, #020617 100%)',
        color: '#f8fafc',
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        style={{ background: 'linear-gradient(90deg, rgba(200,16,46,0.55), transparent)' }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        style={{ background: 'linear-gradient(270deg, rgba(29,78,216,0.6), transparent)' }}
      />
      <Wrestlers
        className="absolute left-1/2 top-[14%] w-[70%] -translate-x-1/2 opacity-30"
        style={{ color: '#e2e8f0' }}
      />
      <div className="relative flex h-full flex-col p-[1.4em] text-center">
        <div className="flex items-center justify-center gap-3">
          <Logo url={d.logoUrl} />
          <Brand color="#fbbf24" />
        </div>
        <div className="mt-auto">
          <p className="text-[0.7em] font-semibold uppercase tracking-[0.3em] text-amber-300">{t('sambo')}</p>
          <h3
            className="mt-[0.3em] font-black uppercase leading-tight"
            style={{ fontSize: nameSize(d.name, 1.6) }}
          >
            {d.name}
          </h3>
          <div
            className="mx-auto mt-[0.7em] h-[3px] w-[40%]"
            style={{ background: 'linear-gradient(90deg,#c8102e,#fbbf24,#1d4ed8)' }}
          />
          <p className="mt-[0.7em] text-[2.2em] font-black leading-none text-amber-300">{date.day}</p>
          <p className="text-[0.95em] font-semibold uppercase">{date.rest}</p>
          {d.city ? <p className="mt-[0.4em] text-[0.8em] opacity-90">{d.city}</p> : null}
          <div className="mt-[0.8em] flex justify-center">
            <Groups
              groups={d.groups}
              style={{ border: '1px solid rgba(251,191,36,0.6)', color: '#fde68a' }}
            />
          </div>
          {d.rated ? (
            <p className="mt-[0.6em] text-[0.62em] font-bold uppercase text-amber-300">★ {t('rated')} ★</p>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

function Minimal({ d, locale, t }: TemplateProps) {
  const date = posterDate(d.startDate, d.endDate, locale);
  return (
    <Frame style={{ background: '#f8fafc', color: '#0f172a' }} className="ring-1 ring-slate-200">
      <div className="absolute left-0 top-0 h-full w-[0.6em]" style={{ background: '#1d4ed8' }} />
      <div className="absolute left-[0.6em] top-0 h-full w-[0.3em]" style={{ background: '#c8102e' }} />
      <div className="relative flex h-full flex-col p-[1.4em] pl-[2em]">
        <div className="flex items-start justify-between gap-3">
          <Brand color="#1d4ed8" />
          <Logo url={d.logoUrl} />
        </div>
        <h3 className="mt-[1.2em] font-extrabold leading-tight" style={{ fontSize: nameSize(d.name, 1.7) }}>
          {d.name}
        </h3>
        <p className="mt-[0.6em] text-[0.8em] text-slate-600">{d.organizerName}</p>
        <div className="mt-auto">
          <p className="text-[3em] font-black leading-none" style={{ color: '#1d4ed8' }}>
            {date.day}
          </p>
          <p className="text-[1em] font-semibold">{date.rest}</p>
          {d.city ? (
            <p className="mt-[0.3em] text-[0.8em] text-slate-700">
              {d.city}
              {d.venueName ? ` · ${d.venueName}` : ''}
            </p>
          ) : null}
          <div className="mt-[0.8em]">
            <Groups groups={d.groups} style={{ background: '#e0e7ff', color: '#1e3a8a' }} />
          </div>
          {d.rated ? (
            <p className="mt-[0.6em] text-[0.62em] font-bold uppercase" style={{ color: '#c8102e' }}>
              {t('rated')}
            </p>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

function Sunrise({ d, locale, t }: TemplateProps) {
  const date = posterDate(d.startDate, d.endDate, locale);
  return (
    <Frame
      style={{ background: 'linear-gradient(160deg, #f59e0b 0%, #ea580c 45%, #b91c1c 100%)', color: '#fff' }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute -right-[20%] h-[18%] w-[120%] -rotate-12"
          style={{ top: `${18 + i * 22}%`, background: 'rgba(255,255,255,0.08)' }}
        />
      ))}
      <Wrestlers
        className="absolute -left-[6%] bottom-[30%] w-[58%] opacity-25"
        style={{ color: '#fff7ed' }}
      />
      <div className="relative flex h-full flex-col p-[1.4em]">
        <div className="flex items-start justify-between gap-3">
          <Brand color="#fff7ed" />
          <Logo url={d.logoUrl} />
        </div>
        <div className="mt-auto rounded-xl p-[0.9em]" style={{ background: 'rgba(15,23,42,0.35)' }}>
          <p className="text-[0.7em] font-bold uppercase tracking-[0.25em]">{t('sambo')}</p>
          <h3
            className="mt-[0.2em] font-black uppercase leading-tight"
            style={{ fontSize: nameSize(d.name, 1.45) }}
          >
            {d.name}
          </h3>
          <p className="mt-[0.5em] text-[1.4em] font-black leading-none">
            {date.day} <span className="text-[0.6em] font-semibold uppercase">{date.rest}</span>
          </p>
          {d.city ? <p className="mt-[0.3em] text-[0.8em]">{d.city}</p> : null}
          <div className="mt-[0.7em]">
            <Groups groups={d.groups} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }} />
          </div>
          {d.rated ? <p className="mt-[0.5em] text-[0.62em] font-bold uppercase">{t('rated')}</p> : null}
        </div>
      </div>
    </Frame>
  );
}

interface TemplateProps {
  d: PosterData;
  locale: string;
  t: (key: string) => string;
}

const TEMPLATES: Record<PosterTemplate, (p: TemplateProps) => ReactNode> = {
  classic: Classic,
  arena: Arena,
  minimal: Minimal,
  sunrise: Sunrise,
};

/** Название на постере: длинное — мельче, чтобы постер не обрезал низ (дата, город, группы). */
function nameSize(name: string, base: number): string {
  const k = name.length > 90 ? 0.6 : name.length > 60 ? 0.72 : name.length > 36 ? 0.85 : 1;
  return `${(base * k).toFixed(2)}em`;
}

/** Постер; размер шрифта задаёт обёртка (все размеры постера — в em), поэтому он масштабируется целиком. */
export function Poster({ data, template }: { data: PosterData; template: string }) {
  const t = useTranslations('tournamentPage.poster');
  const locale = useLocale();
  const Template = TEMPLATES[isPosterTemplate(template) ? template : 'classic'];
  return <Template d={data} locale={locale} t={(k) => t(k)} />;
}
