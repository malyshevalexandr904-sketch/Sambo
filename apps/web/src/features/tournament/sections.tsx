'use client';
// Разделы публичной страницы турнира (правки 05.11.2026): положение, регистрация, турнирные сетки и итоговые
// протоколы, прямая трансляция, медиа. Что показать в разделе, зависит от стадии турнира.
import {
  categoryWeightLabel,
  type Competition,
  type CompetitionMediaDto,
  type DataEnvelope,
  type PublicBracketsDto,
  type PublicCategoryBracket,
  type PublicCompetition,
  type PublicLiveDto,
  stageOfCompetition,
} from '@sde/contracts';
import { Alert, Button, cn } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { currentSubscription, enablePush, pushConfig, pushSupport } from '@/lib/push';
import { useMe } from '@/lib/queries';
import { DownloadIcon, ShareButton, ShareIcon } from './share';
import { useViewerCompetition } from './viewer';

const Box = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-xl border border-slate-200 bg-white p-4 sm:p-6', className)}>{children}</section>
);

/** Заглушка раздела «скоро»: значок, заголовок и пояснение. */
function Placeholder({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <Box className="text-center">
      <p aria-hidden="true" className="stage-float text-5xl">
        {icon}
      </p>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{text}</p>
    </Box>
  );
}

function fmt(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

// ---------- Положение ----------

export function RegulationSection({ competition: c }: { competition: PublicCompetition }) {
  const t = useTranslations('tournamentPage.regulation');
  // Сформированное положение (PDF платформы) — поле появится в контракте вместе с генератором положения.
  const pdf = (c as PublicCompetition & { regulationPdfUrl?: string | null }).regulationPdfUrl ?? c.regulationUrl;
  if (!pdf) return <Placeholder icon="📄" title={t('tbdTitle')} text={t('tbdText')} />;
  const sameOrigin = pdf.startsWith('/');
  const download = sameOrigin ? `${pdf}${pdf.includes('?') ? '&' : '?'}download=1` : pdf;
  return (
    <Box>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <div className="flex flex-wrap gap-2">
          <a
            href={download}
            download={sameOrigin ? undefined : `${c.slug}-polozhenie.pdf`}
            className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
          >
            <DownloadIcon className="mr-2" />
            {t('download')}
          </a>
          <ShareButton
            title={t('shareTitle', { name: c.name })}
            path={`/tournaments/${c.slug}#regulation`}
            label={t('share')}
          />
        </div>
      </div>
      <iframe
        src={pdf}
        title={t('viewer', { name: c.name })}
        className="h-[75vh] min-h-[480px] w-full rounded-lg border border-slate-200 bg-slate-50"
      />
      <p className="mt-2 text-xs text-slate-500">
        {t('notShown')}{' '}
        <a href={pdf} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
          {t('openTab')}
        </a>
      </p>
    </Box>
  );
}

// ---------- Регистрация ----------

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}

function FollowButton({ viewer }: { viewer: Competition }) {
  const t = useTranslations('tournamentPage.registration');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const toggle = async (follow: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/competitions/${viewer.id}/follow`, { method: 'PUT', body: { follow } });
      await queryClient.invalidateQueries({ queryKey: ['competitions', 'slug', viewer.slug] });
      // Push — по желанию: браузер спросит разрешение; отказ не мешает подписке (лента и почта остаются).
      if (follow && me && pushSupport() === 'supported' && !(await currentSubscription())) {
        try {
          const cfg = await pushConfig();
          if (cfg.enabled && cfg.publicKey) {
            await enablePush(me.id, cfg.publicKey);
            setPushNote(t('pushOn'));
          }
        } catch {
          setPushNote(t('pushOff'));
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4">
      {error ? (
        <Alert tone="danger" className="mb-2">
          {error}
        </Alert>
      ) : null}
      {viewer.followed ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-sm text-green-900">
            <span aria-hidden="true">🔔</span>
            {t('followed')}
          </span>
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void toggle(false)}>
            {t('unfollow')}
          </Button>
        </div>
      ) : (
        <Button loading={busy} onClick={() => void toggle(true)}>
          <span aria-hidden="true" className="mr-2">
            🔔
          </span>
          {t('follow')}
        </Button>
      )}
      {pushNote ? <p className="mt-2 text-xs text-slate-600">{pushNote}</p> : null}
      <p className="mt-2 text-xs text-slate-500">{t('followHint')}</p>
    </div>
  );
}

export function RegistrationSection({ competition: c }: { competition: PublicCompetition }) {
  const t = useTranslations('tournamentPage.registration');
  const locale = useLocale();
  const pathname = usePathname();
  const viewer = useViewerCompetition(c.slug);
  const stage = stageOfCompetition(c.status);
  const from = fmt(c.registrationStartsAt, c.timezone, locale);
  const to = fmt(c.registrationEndsAt, c.timezone, locale);
  const login = (
    <Link
      href={{ pathname: '/login', query: { next: pathname } }}
      className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
    >
      {t('loginToFollow')}
    </Link>
  );
  if (stage === 'PUBLISHED')
    return (
      <Box>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-blue-50 text-blue-900">
            <span className="text-3xl font-black leading-none">{daysUntil(c.registrationStartsAt)}</span>
            <span className="text-[11px]">{t('daysLeft')}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{t('soonTitle')}</h3>
            <p className="mt-1 text-sm text-slate-700">{t('window', { from, to })}</p>
            <p className="mt-1 text-sm text-slate-600">{t('whoCan')}</p>
          </div>
        </div>
        {viewer.data ? <FollowButton viewer={viewer.data} /> : viewer.isPending ? null : login}
      </Box>
    );
  if (stage === 'REGISTRATION') {
    const canApply = viewer.data?.registrationOpenNow;
    return (
      <Box>
        <div className="flex flex-wrap items-start gap-4">
          <span aria-hidden="true" className="stage-pulse flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">
            ✅
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-green-900">{t('openTitle')}</h3>
            <p className="mt-1 text-sm text-slate-700">{t('openUntil', { to })}</p>
          </div>
        </div>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((s, i) => (
            <li key={s} className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">
                {i + 1}
              </span>
              {t(s)}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-600">{t('whoCan')}</p>
        {canApply && viewer.data ? (
          <Link
            href={`/competitions/${viewer.data.id}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
          >
            {t('apply')}
          </Link>
        ) : viewer.data || viewer.isPending ? null : (
          <Link
            href={{ pathname: '/login', query: { next: pathname } }}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
          >
            {t('loginToApply')}
          </Link>
        )}
      </Box>
    );
  }
  return (
    <Placeholder
      icon="🔒"
      title={t('closedTitle')}
      text={t('closedText', { from, to })}
    />
  );
}

// ---------- Турнирные сетки и протоколы ----------

const MEDAL: Record<string, string> = { GOLD: '🥇', SILVER: '🥈', BRONZE: '🥉' };

function protocolCsv(cat: PublicCategoryBracket, title: string, hidden: string): string {
  const names = new Map(cat.participants.map((p) => [p.entryId, p]));
  const rows = [['Место', 'Спортсмен', 'Клуб', 'Регион', 'Побед', 'Поражений']];
  for (const p of cat.placements ?? []) {
    const info = names.get(p.entryId);
    rows.push([
      String(p.place),
      info?.name ?? hidden,
      info?.club ?? '',
      info?.region ?? '',
      String(p.wins),
      String(p.losses),
    ]);
  }
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return `﻿${title}\n${rows.map((r) => r.map(esc).join(';')).join('\n')}`;
}

function CategoryBracket({ cat, final }: { cat: PublicCategoryBracket; final: boolean }) {
  const t = useTranslations('tournamentPage.brackets');
  const tr = useTranslations('bracket');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const title = `${lang === 'en' ? cat.name.en : cat.name.ru}`;
  const names = new Map(cat.participants.map((p) => [p.entryId, p]));
  const rounds = useMemo(() => {
    const m = new Map<string, typeof cat.matches>();
    for (const x of [...cat.matches].sort((a, b) => a.round - b.round || a.position - b.position)) {
      const key = x.stage === 'REPECHAGE' || x.label === 'BRONZE' ? `${x.stage}:${x.label}` : `${x.stage}:${x.round}`;
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return [...m.values()];
  }, [cat]);
  const download = (): void => {
    const blob = new Blob([protocolCsv(cat, title, t('hiddenName'))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `protokol-${cat.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      {cat.placements ? (
        <Box className="print-area">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">{t('protocol')}</h4>
            <div className="flex gap-2 print:hidden">
              <Button size="sm" variant="secondary" onClick={download}>
                <DownloadIcon className="mr-1.5 h-4 w-4" />
                {t('downloadCsv')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                {t('print')}
              </Button>
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-2 font-medium">{t('place')}</th>
                <th className="py-2 pr-2 font-medium">{t('athlete')}</th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">{t('club')}</th>
                <th className="py-2 text-right font-medium">{t('winsLosses')}</th>
              </tr>
            </thead>
            <tbody>
              {cat.placements.map((p) => {
                const info = names.get(p.entryId);
                return (
                  <tr key={p.entryId} className={cn('border-b border-slate-100', p.medal ? 'font-medium' : '')}>
                    <td className="py-2 pr-2 tabular-nums">
                      {p.medal ? <span aria-hidden="true">{MEDAL[p.medal]} </span> : null}
                      {p.place}
                    </td>
                    <td className="py-2 pr-2">{info?.name ?? <span className="text-slate-500">{t('hiddenName')}</span>}</td>
                    <td className="hidden py-2 pr-2 text-slate-600 sm:table-cell">{info?.club ?? ''}</td>
                    <td className="py-2 text-right tabular-nums">
                      {p.wins} / {p.losses}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      ) : null}
      {rounds.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {rounds.map((list) => (
            <section key={`${list[0]?.stage}:${list[0]?.round}:${list[0]?.label}`} className="w-60 shrink-0">
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {list[0]?.group ? `${t('group')} ${list[0].group} · ` : ''}
                {tr.has(`rounds.${list[0]?.label ?? ''}`) ? tr(`rounds.${list[0]?.label ?? ''}`) : (list[0]?.label ?? '')}
              </h5>
              <ul className="space-y-2">
                {list.map((m) => (
                  <li
                    key={m.key}
                    className={cn(
                      'rounded-lg border bg-white text-sm shadow-sm',
                      m.status === 'IN_PROGRESS' ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200',
                    )}
                  >
                    {(['red', 'blue'] as const).map((side) => {
                      const won = m.winner === side.toUpperCase();
                      const n = m[side];
                      return (
                        <div
                          key={side}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5',
                            side === 'red' ? 'border-b border-slate-100' : '',
                            won ? 'font-semibold' : m.winner ? 'text-slate-500' : '',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn('h-3 w-1.5 rounded-sm', side === 'red' ? 'bg-red-600' : 'bg-blue-600')}
                          />
                          <span className="min-w-0 flex-1 truncate">{n ?? (m.status === 'PENDING' ? '—' : t('hiddenName'))}</span>
                          {won ? <span aria-label={t('winner')}>✓</span> : null}
                        </div>
                      );
                    })}
                    {m.score || m.status === 'IN_PROGRESS' ? (
                      <p className="border-t border-slate-100 px-2 py-1 text-xs text-slate-600">
                        {m.status === 'IN_PROGRESS' ? <span className="text-amber-700">● {t('live')} </span> : null}
                        {m.score ?? ''}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : final ? null : (
        <p className="text-sm text-slate-600">{t('noMatches')}</p>
      )}
    </div>
  );
}

export function BracketsSection({
  competition: c,
  data,
}: {
  competition: PublicCompetition;
  data: PublicBracketsDto | null;
}) {
  const t = useTranslations('tournamentPage.brackets');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const stage = stageOfCompetition(c.status);
  const cats = data?.categories ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  if (cats.length === 0)
    return stage === 'DRAW' ? (
      <Placeholder icon="🎲" title={t('drawingTitle')} text={t('drawingText')} />
    ) : (
      <Placeholder icon="🗂️" title={t('emptyTitle')} text={t('emptyText')} />
    );
  const current = cats.find((x) => x.code === selected) ?? cats[0];
  if (!current) return null;
  return (
    <div className="space-y-4">
      {stage === 'FINISHED' ? <Alert tone="success">{t('finalNote')}</Alert> : null}
      {stage === 'LIVE' ? <Alert tone="info">{t('liveNote')}</Alert> : null}
      <div role="tablist" aria-label={t('categories')} className="flex gap-2 overflow-x-auto pb-1">
        {cats.map((x) => (
          <button
            key={x.code}
            type="button"
            role="tab"
            aria-selected={x.code === current.code}
            onClick={() => setSelected(x.code)}
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-4 text-sm',
              x.code === current.code
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400',
            )}
          >
            {(lang === 'en' ? x.name.en : x.name.ru).split(',')[0]} · {categoryWeightLabel(x.weight, lang)}
          </button>
        ))}
      </div>
      <CategoryBracket cat={current} final={stage === 'FINISHED'} />
    </div>
  );
}

// ---------- Прямая трансляция ----------

/** Адрес встроенного плеера: YouTube, Rutube, VK Видео; иначе — null (только ссылка). */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v'))
      return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`;
    if (host === 'youtube.com' && u.pathname.startsWith('/live/'))
      return `https://www.youtube-nocookie.com/embed/${u.pathname.split('/')[2]}`;
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    const rutube = /^\/(?:video|live\/video)\/([a-z0-9]+)/i.exec(u.pathname);
    if (host === 'rutube.ru' && rutube) return `https://rutube.ru/play/embed/${rutube[1]}`;
    const vk = /video(-?\d+)_(\d+)/.exec(url);
    if ((host === 'vk.com' || host === 'vkvideo.ru') && vk) return `https://vk.com/video_ext.php?oid=${vk[1]}&id=${vk[2]}&hd=2`;
    return null;
  } catch {
    return null;
  }
}

export function LiveSection({ competition: c, data }: { competition: PublicCompetition; data: PublicLiveDto | null }) {
  const t = useTranslations('tournamentPage.live');
  const stage = stageOfCompetition(c.status);
  if (stage !== 'LIVE') return <Placeholder icon="📺" title={t('soonTitle')} text={t('soonText')} />;
  const embed = data?.streamUrl ? embedUrl(data.streamUrl) : null;
  return (
    <div className="space-y-4">
      {data?.streamUrl ? (
        <Box>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span className="stage-pulse inline-block h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />
            {t('stream')}
          </h3>
          {embed ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={embed}
                title={t('stream')}
                className="h-full w-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : null}
          <a
            href={data.streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center text-blue-700 underline"
          >
            {t('openStream')}
          </a>
        </Box>
      ) : null}
      <Box>
        <h3 className="mb-1 text-lg font-semibold">{t('mats')}</h3>
        <p className="mb-3 text-sm text-slate-600">{t('matsHint')}</p>
        {(data?.mats ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">{t('noMats')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.mats ?? []).map((m) => (
              <li key={m.id}>
                <Link
                  href={`/scoreboard/mat/${m.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-blue-400"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-700 text-lg font-bold text-white">
                    {m.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{m.name ?? t('mat', { number: m.number })}</span>
                    <span className="text-xs text-slate-600">{t('scoreboard')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}

// ---------- Медиа ----------

export function MediaSection({ media }: { media: CompetitionMediaDto[] | null }) {
  const t = useTranslations('tournamentPage.media');
  const [open, setOpen] = useState<number | null>(null);
  const photos = (media ?? []).filter((m) => m.kind === 'PHOTO');
  const videos = (media ?? []).filter((m) => m.kind === 'VIDEO');
  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, photos.length]);
  if (photos.length === 0 && videos.length === 0)
    return <Placeholder icon="📸" title={t('emptyTitle')} text={t('emptyText')} />;
  const shown = open !== null ? photos[open] : undefined;
  return (
    <div className="space-y-4">
      {videos.length > 0 ? (
        <Box>
          <h3 className="mb-3 text-lg font-semibold">{t('videos')}</h3>
          <ul className="grid gap-4 md:grid-cols-2">
            {videos.map((v) => {
              const embed = embedUrl(v.url);
              return (
                <li key={v.id}>
                  {embed ? (
                    <div className="aspect-video overflow-hidden rounded-lg bg-black">
                      <iframe src={embed} title={v.caption ?? t('video')} className="h-full w-full" allowFullScreen />
                    </div>
                  ) : null}
                  <a href={v.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm text-blue-700 underline">
                    {v.caption ?? t('openVideo')}
                  </a>
                </li>
              );
            })}
          </ul>
        </Box>
      ) : null}
      {photos.length > 0 ? (
        <Box>
          <h3 className="mb-3 text-lg font-semibold">{t('photos', { count: photos.length })}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="group block aspect-square w-full overflow-hidden rounded-lg bg-slate-100"
                  aria-label={p.caption ?? t('photo', { n: i + 1 })}
                >
                  <img
                    src={p.url}
                    alt={p.caption ?? ''}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </button>
              </li>
            ))}
          </ul>
        </Box>
      ) : null}
      {shown ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={shown.caption ?? t('photo', { n: (open ?? 0) + 1 })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
        >
          <img src={shown.url} alt={shown.caption ?? ''} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
          {shown.caption ? (
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white">
              {shown.caption}
            </p>
          ) : null}
          <button type="button" className="absolute right-4 top-4 text-3xl text-white" aria-label={t('close')}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { ShareIcon };
export type { DataEnvelope };
