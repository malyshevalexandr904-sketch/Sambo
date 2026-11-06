'use client';
// Личный кабинет как страница в соцсети (правки 05.11.2026, п. 5): обложка, фото, ФИО, клуб и возраст, а у
// спортсмена — Elo, медали, история схваток и выступлений. Только отображение: данные приносит profile.tsx, а в
// демо-входе — пример (example.ts).
import type { AthleteResultDto, Medal, PublicRatingHistoryItem } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { formatDates } from '@/features/competitions/shared';
import { EloTracker } from '@/features/rating/elo-tracker';
import { Link } from '@/i18n/navigation';
import { pickName } from '@/lib/queries';
import { CountUp, Ring } from './animated';

export interface ProfileFact {
  icon: IconName;
  label: string;
  value: string;
  href?: string;
}

export interface AthleteStats {
  rating: {
    rating: number;
    level: number;
    peakRating: number;
    ratedMatches: number;
    wins: number;
    losses: number;
  } | null;
  division: string | null;
  bouts: PublicRatingHistoryItem[];
  medals: Record<Medal, number>;
  competitions: number;
  results: AthleteResultDto[];
}

export interface ProfileViewProps {
  name: string;
  avatarUrl: string | null;
  roleLabel: string | null;
  facts: ProfileFact[];
  /** Спортсмен: статистика; 'pending' — профиль спортсмена ещё не создан (анкета на проверке). */
  athlete?: AthleteStats | 'pending' | 'loading';
  /** Дополнительные блоки под шапкой (организации, дети). */
  children?: ReactNode;
  /** Ссылка «Редактировать профиль»; в демо — нет. */
  editHref?: string;
  /** Подпись над шапкой (демо: «Пример»). */
  ribbon?: ReactNode;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/** Обложка: цвета самбо (синий и красный) и мягко плывущие круги. */
function Cover() {
  return (
    <div className="relative h-32 overflow-hidden bg-gradient-to-br from-blue-600 via-blue-800 to-blue-950 sm:h-44">
      <svg
        viewBox="0 0 800 200"
        preserveAspectRatio="xMidYMid slice"
        className="profile-cover-drift absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <circle cx="690" cy="40" r="120" fill="white" fillOpacity="0.07" />
        <circle cx="560" cy="190" r="80" fill="white" fillOpacity="0.05" />
        <circle cx="90" cy="-10" r="90" fill="white" fillOpacity="0.06" />
        <path d="M430 220 L620 -20 L660 -20 L470 220 Z" fill="#dc2626" fillOpacity="0.55" />
        <path d="M480 220 L670 -20 L690 -20 L500 220 Z" fill="white" fillOpacity="0.25" />
      </svg>
    </div>
  );
}

function BigAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <span
      className="profile-avatar animate-pop relative inline-flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-3xl font-bold text-blue-800 sm:h-36 sm:w-36 sm:text-4xl"
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}

function Header({ name, avatarUrl, roleLabel, facts, editHref, ribbon }: ProfileViewProps) {
  const t = useTranslations('profile');
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative">
        <Cover />
        {ribbon ? <div className="absolute left-4 top-4">{ribbon}</div> : null}
      </div>
      <div className="px-4 pb-5 sm:px-8">
        <div className="-mt-14 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end">
          <BigAvatar name={name} avatarUrl={avatarUrl} />
          <div className="min-w-0 flex-1 animate-fade-up sm:pb-2" style={{ animationDelay: '120ms' }}>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{name}</h1>
            {roleLabel ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800">
                <Icon name="star" className="h-4 w-4" />
                {roleLabel}
              </p>
            ) : null}
          </div>
          {editHref ? (
            <Link
              href={editHref}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 sm:self-end"
            >
              <Icon name="palette" className="h-4 w-4" />
              {t('edit')}
            </Link>
          ) : null}
        </div>
        {facts.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-2">
            {facts.map((f, i) => {
              const body = (
                <>
                  <Icon name={f.icon} className="h-4 w-4 text-blue-700" />
                  <span className="text-slate-600">{f.label}:</span>
                  <span className="font-medium text-slate-900">{f.value}</span>
                </>
              );
              const cls =
                'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm';
              return (
                <li key={f.label} className="animate-fade-up" style={{ animationDelay: `${200 + i * 70}ms` }}>
                  {f.href ? (
                    <Link href={f.href} className={cn(cls, 'hover:border-blue-300 hover:bg-blue-50')}>
                      {body}
                    </Link>
                  ) : (
                    <span className={cls}>{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Panel({
  title,
  icon,
  children,
  className,
  delay = 0,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn(
        'animate-fade-up rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6',
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon name={icon} className="h-4.5 w-4.5" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const MEDALS: { medal: Medal; face: string; rim: string; ribbon: string; text: string }[] = [
  { medal: 'GOLD', face: '#facc15', rim: '#ca8a04', ribbon: '#2563eb', text: '#713f12' },
  { medal: 'SILVER', face: '#e2e8f0', rim: '#94a3b8', ribbon: '#dc2626', text: '#334155' },
  { medal: 'BRONZE', face: '#fdba74', rim: '#c2410c', ribbon: '#2563eb', text: '#7c2d12' },
];

/** Медаль с лентой: цвет продублирован подписью. */
function MedalIcon({ face, rim, ribbon, text, n }: (typeof MEDALS)[number] & { n: number }) {
  return (
    <svg viewBox="0 0 64 80" className="h-20 w-16" aria-hidden="true">
      <path d="M18 0h12l6 26H24z" fill={ribbon} />
      <path d="M46 0H34l-6 26h12z" fill={ribbon} opacity="0.75" />
      <circle cx="32" cy="50" r="24" fill={rim} />
      <circle cx="32" cy="50" r="19" fill={face} />
      <path d="M20 40a16 16 0 0 1 12-7" stroke="white" strokeOpacity="0.7" strokeWidth="3" fill="none" />
      <text x="32" y="57" textAnchor="middle" fontSize="20" fontWeight="700" fill={text}>
        {n}
      </text>
    </svg>
  );
}

function Medals({ medals, competitions }: { medals: Record<Medal, number>; competitions: number }) {
  const t = useTranslations('profile');
  const tm = useTranslations('results.medals');
  return (
    <Panel title={t('medals')} icon="trophy" delay={160}>
      <ul className="grid grid-cols-3 gap-2">
        {MEDALS.map((m, i) => (
          <li key={m.medal} className="flex flex-col items-center text-center">
            <span className="medal-swing" style={{ animationDelay: `${300 + i * 150}ms` }}>
              <MedalIcon {...m} n={i + 1} />
            </span>
            <span className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
              <CountUp value={medals[m.medal]} delayMs={300 + i * 150} />
            </span>
            <span className="text-sm text-slate-600">{tm(m.medal)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-center text-sm text-slate-700">
        {t('medalsSummary', { competitions, medals: medals.GOLD + medals.SILVER + medals.BRONZE })}
      </p>
    </Panel>
  );
}

function RatingPanel({ stats }: { stats: AthleteStats }) {
  const t = useTranslations('profile');
  const span = 'xl:col-span-2';
  const r = stats.rating;
  const last = stats.bouts.filter((b) => b.kind === 'MATCH').at(-1);
  if (!r) {
    return (
      <Panel title={t('elo')} icon="chart" delay={80} className={span}>
        <EmptyNote icon="chart" text={t('noRating')} />
      </Panel>
    );
  }
  const total = r.wins + r.losses;
  return (
    <Panel title={t('elo')} icon="chart" delay={80} className={span}>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <p className="text-5xl font-extrabold tabular-nums text-blue-800 sm:text-6xl">
            <CountUp value={r.rating} />
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-blue-700 px-2.5 py-0.5 font-semibold text-white">
              {t('level', { level: r.level })}
            </span>
            {last ? (
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-semibold',
                  last.delta >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
                )}
              >
                {last.delta > 0 ? '▲ +' : last.delta < 0 ? '▼ ' : ''}
                {last.delta} {t('lastBout')}
              </span>
            ) : null}
          </p>
          {stats.division ? <p className="mt-2 text-sm text-slate-600">{stats.division}</p> : null}
        </div>
        <Ring
          share={total ? r.wins / total : 0}
          label={total ? `${Math.round((r.wins / total) * 100)}%` : '—'}
          sub={t('winRate')}
        />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            [t('peak'), r.peakRating],
            [t('bouts'), r.ratedMatches],
            [t('wins'), r.wins],
            [t('losses'), r.losses],
          ] as const
        ).map(([k, v], i) => (
          <div key={k} className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-600">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900">
              <CountUp value={v} delayMs={150 + i * 80} />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function EmptyNote({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
      <span className="animate-float flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="max-w-sm text-sm text-slate-600">{text}</p>
    </div>
  );
}

const STEP = 6;

function FightHistory({ bouts }: { bouts: PublicRatingHistoryItem[] }) {
  const t = useTranslations('profile');
  const tr = useTranslations('rating');
  const locale = useLocale();
  const [count, setCount] = useState(STEP);
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium' });
  const matches = [...bouts].filter((b) => b.kind === 'MATCH').reverse();
  return (
    <Panel title={t('fights')} icon="swords" delay={240} className="xl:col-span-2">
      {matches.length === 0 ? (
        <EmptyNote icon="swords" text={t('noFights')} />
      ) : (
        <>
          <ol className="space-y-2">
            {matches.slice(0, count).map((b, i) => {
              const win = b.delta > 0 || (b.outcome?.includes('WIN') ?? false);
              const opponent = b.opponent?.hidden ? t('hiddenOpponent') : (b.opponent?.name ?? '—');
              return (
                <li
                  key={`${b.at}-${i}`}
                  className="animate-fade-up flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-blue-200 hover:bg-slate-50"
                  style={{ animationDelay: `${Math.min(i, STEP) * 50}ms` }}
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      win ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
                    )}
                    aria-label={win ? t('win') : t('loss')}
                  >
                    {win ? t('winShort') : t('lossShort')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">
                      {t('vs', { name: opponent })}
                      {b.opponent && !b.opponent.hidden ? (
                        <span className="font-normal text-slate-500"> · {b.opponent.ratingBefore}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-slate-600">
                      {[
                        b.outcome ? tr(`outcomes.${b.outcome}`) : null,
                        b.competition?.name,
                        date.format(new Date(b.at)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums text-slate-900">{b.ratingAfter}</span>
                    <span
                      className={cn(
                        'block text-xs font-semibold tabular-nums',
                        b.delta >= 0 ? 'text-green-800' : 'text-red-800',
                      )}
                    >
                      {b.delta > 0 ? '+' : ''}
                      {b.delta}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          {matches.length > count ? (
            <button
              type="button"
              onClick={() => setCount((c) => c + STEP)}
              className="mt-3 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
            >
              {t('more', { n: Math.min(STEP, matches.length - count) })}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}

const PLACE_STYLE: Record<number, string> = {
  1: 'bg-amber-100 text-amber-900 ring-amber-400',
  2: 'bg-slate-100 text-slate-800 ring-slate-400',
  3: 'bg-orange-100 text-orange-900 ring-orange-400',
};

function Tournaments({ results }: { results: AthleteResultDto[] }) {
  const t = useTranslations('profile');
  const tLevel = useTranslations('competitions.levels');
  const locale = useLocale();
  return (
    <Panel title={t('tournaments')} icon="calendar" delay={320}>
      {results.length === 0 ? (
        <EmptyNote icon="calendar" text={t('noTournaments')} />
      ) : (
        <ol className="relative space-y-4 border-l-2 border-blue-100 pl-6">
          {results.map((r, i) => (
            <li
              key={`${r.competitionId}-${pickName(r.categoryName, 'ru')}`}
              className="animate-fade-up relative"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span
                className={cn(
                  'absolute -left-[2.35rem] top-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ring-2 ring-inset',
                  PLACE_STYLE[r.place] ?? 'bg-white text-slate-700 ring-slate-300',
                )}
                aria-label={t('place', { place: r.place })}
              >
                {r.place}
              </span>
              <p className="font-medium text-slate-900">{r.competitionName}</p>
              <p className="text-sm text-slate-600">
                {formatDates(r.startDate, r.endDate, locale)} · {tLevel(r.level)}
              </p>
              <p className="text-sm text-slate-700">
                {pickName(r.categoryName, locale)} · {t('record', { wins: r.wins, losses: r.losses })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function AthleteSections({ stats }: { stats: AthleteStats }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const hasBouts = stats.bouts.some((b) => b.kind === 'MATCH');
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-3">
      <RatingPanel stats={stats} />
      <Medals medals={stats.medals} competitions={stats.competitions} />
      <Panel title={t('tracker')} icon="chart" delay={200} className="xl:col-span-3">
        {hasBouts ? (
          <EloTracker bouts={stats.bouts} locale={locale} />
        ) : (
          <EmptyNote icon="chart" text={t('noTracker')} />
        )}
      </Panel>
      <FightHistory bouts={stats.bouts} />
      <Tournaments results={stats.results} />
    </div>
  );
}

export function ProfileView(props: ProfileViewProps) {
  const t = useTranslations('profile');
  const { athlete } = props;
  return (
    <div className="mx-auto max-w-6xl">
      <Header {...props} />
      {athlete === 'pending' ? (
        <div className="mt-6">
          <EmptyNote icon="user" text={t('athletePending')} />
        </div>
      ) : athlete === 'loading' ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : athlete ? (
        <AthleteSections stats={athlete} />
      ) : null}
      {props.children ? <div className="mt-6 grid gap-6 xl:grid-cols-2">{props.children}</div> : null}
    </div>
  );
}

export { Panel as ProfilePanel, EmptyNote as ProfileEmpty };
