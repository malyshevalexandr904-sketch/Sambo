'use client';
// Публичная страница турнира по стадиям (правки 05.11.2026): шапка со шкалой стадий и кнопкой «Поделиться»,
// вкладки разделов. Набор разделов задаёт стадия (`publicSectionsOf`); во время жеребьёвки и соревнований страница
// сама обновляет сетки и трансляцию.
import {
  type CompetitionMediaDto,
  type PublicBracketsDto,
  type PublicCompetition,
  type PublicLiveDto,
  type PublicSection,
  publicSectionsOf,
  stageOfCompetition,
} from '@sde/contracts';
import { cn } from '@sde/ui';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { BracketsSection } from './brackets';
import { LiveSection, MediaSection } from './live-media';
import { Poster, posterDataOf } from './poster';
import { RegistrationSection, RegulationSection } from './sections';
import { ShareButton } from './share';
import { StageStepper } from './stage-stepper';
import { RegulationSummary } from './summary';

const ICON: Record<PublicSection, string> = {
  poster: '🖼️',
  regulation: '📄',
  registration: '📝',
  brackets: '🗂️',
  live: '📺',
  media: '📸',
};

const REFRESH_MS = 30_000;

function dates(start: string, end: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const s = new Date(`${start}T00:00:00Z`);
  return start === end ? fmt.format(s) : fmt.formatRange(s, new Date(`${end}T00:00:00Z`));
}

const isSection = (v: string, list: PublicSection[]): v is PublicSection => (list as string[]).includes(v);

export function TournamentPage({
  competition: c,
  brackets,
  live,
  media,
}: {
  competition: PublicCompetition;
  brackets: PublicBracketsDto | null;
  live: PublicLiveDto | null;
  media: CompetitionMediaDto[] | null;
}) {
  const t = useTranslations('tournamentPage');
  const tt = useTranslations('tournaments');
  const ts = useTranslations('stages');
  const locale = useLocale();
  const router = useRouter();
  const stage = stageOfCompetition(c.status);
  const sections = useMemo(() => publicSectionsOf(c.status), [c.status]);
  const first = sections[0] ?? 'poster';
  const [active, setActive] = useState<PublicSection>(first);

  // Раздел из адреса (#regulation): ссылкой «Поделиться» из положения открывается сразу положение.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      if (isSection(h, sections)) setActive(h);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [sections]);

  const open = useCallback((s: PublicSection) => {
    setActive(s);
    window.history.replaceState(null, '', `#${s}`);
  }, []);

  // Жеребьёвка и соревнования: сетки и табло меняются — обновляем данные страницы, пока вкладка видна.
  useEffect(() => {
    if (stage !== 'DRAW' && stage !== 'LIVE') return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [stage, router]);

  const current = isSection(active, sections) ? active : first;
  const name = (x: { ru: string; en: string }) => (locale === 'en' ? x.en : x.ru);

  return (
    <div>
      <p className="text-sm">
        <Link href="/tournaments" className="text-blue-700 underline">
          ← {tt('backToList')}
        </Link>
      </p>

      <header className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          {c.logoUrl ? (
            <img
              src={c.logoUrl}
              alt=""
              width={72}
              height={72}
              className="h-16 w-16 rounded object-contain sm:h-18 sm:w-18"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{c.name}</h1>
            <p className="mt-1 text-slate-700">
              {dates(c.startDate, c.endDate, locale)}
              {c.city ? ` · ${c.city}` : ''} · {name(c.discipline)}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">{c.organizerName}</p>
            {c.competitionType === 'RATED' ? (
              <span className="mt-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-sm font-medium text-amber-900">
                {tt('rating.badge')}
              </span>
            ) : null}
          </div>
          <ShareButton
            title={c.name}
            text={t('shareText', { name: c.name, dates: dates(c.startDate, c.endDate, locale) })}
            label={t('shareTournament')}
          />
        </div>
        {stage ? (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm text-slate-600">
              {ts('nowLabel')} <span className="font-semibold text-slate-900">{ts(`names.${stage}`)}</span>
              {' — '}
              {ts(`public.${stage}`)}
            </p>
            <StageStepper stage={stage} />
          </div>
        ) : null}
        {c.cancelReason || c.status === 'CANCELLED' ? (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
            {c.cancelReason ? tt('cancelledBecause', { reason: c.cancelReason }) : t('cancelled')}
          </p>
        ) : null}
      </header>

      <nav
        role="tablist"
        aria-label={t('sectionsLabel')}
        className="sticky top-0 z-10 -mx-4 mt-4 flex gap-1 overflow-x-auto bg-slate-50/95 px-4 py-2 backdrop-blur"
      >
        {sections.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`tab-${s}`}
            aria-selected={s === current}
            aria-controls={`panel-${s}`}
            onClick={() => open(s)}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition',
              s === current
                ? 'bg-blue-700 text-white shadow'
                : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-400',
            )}
          >
            <span aria-hidden="true">{ICON[s]}</span>
            {t(`sections.${s}`)}
            {s === 'live' && stage === 'LIVE' ? (
              <span className="stage-pulse h-2 w-2 rounded-full bg-red-500" aria-label={t('liveNow')} />
            ) : null}
          </button>
        ))}
      </nav>

      <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} className="mt-3">
        {current === 'poster' ? (
          <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr]">
            <div>
              <div className="poster-in text-[clamp(13px,4.6vw,19px)] md:text-[19px]">
                <Poster data={posterDataOf(c, locale)} template={c.posterTemplate} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ShareButton
                  title={c.name}
                  text={t('shareText', { name: c.name, dates: dates(c.startDate, c.endDate, locale) })}
                  label={t('shareTournament')}
                  variant="primary"
                />
              </div>
            </div>
            <RegulationSummary competition={c} />
          </div>
        ) : null}
        {current === 'regulation' ? <RegulationSection competition={c} /> : null}
        {current === 'registration' ? <RegistrationSection competition={c} /> : null}
        {current === 'brackets' ? <BracketsSection competition={c} data={brackets} /> : null}
        {current === 'live' ? <LiveSection competition={c} data={live} /> : null}
        {current === 'media' ? <MediaSection media={media} /> : null}
      </div>
    </div>
  );
}
